/**
 * session-title.ts — session topic + rolling "Last 3" summary chips
 *
 * v2 renders through ctx.ui.setStatus() chips so it coexists with any
 * custom footer (pi-cc-extensions, …). v1 built its own footer via
 * setFooter(), which is exclusive — last setter wins — and was silently
 * replaced whenever another footer extension loaded.
 *
 *   session-topic  ◆ session theme (derived from the first user message;
 *                  /topic [name] to change; restored on resume)
 *   recent-topic   Last 3: xxx (summarized by a cheap model after each
 *                  agent_settled; falls back to a heuristic when no model
 *                  is reachable)
 *
 * Place the two keys on a dedicated footer line via pi-cc-extensions:
 *   { "footerLine3Keys": ["session-topic", "recent-topic"] }
 * Without that config they are auto-appended to line 2 (cwd/git).
 *
 * Design rule carried over from v1: the topic is NEVER persisted as the
 * session name. Pi writes the session name into the terminal tab title on
 * startup/reload/session switch, so this extension only ever *clears*
 * stale names (written by an even older version) and keeps everything in
 * memory.
 *
 * Summary model selection — conservative, no surprise spend:
 *   1. PI_TOPIC_SUMMARY_MODELS="provider/id,provider/id" (first configured wins)
 *   2. fallback: the active session model (already in use, zero extra cost)
 * No auto-picking from the registry: a heuristic could silently select a
 * paid model the user never intended to call. No provider is hardcoded.
 */

import { uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const MAX_TOPIC_LEN = 40;
const MAX_RECENT_LEN = 30;
/** How many recent Q&A rounds feed the summary (PI_TOPIC_ROUNDS, 1–10). */
const QA_ROUNDS = Math.max(1, Math.min(10, Number(process.env.PI_TOPIC_ROUNDS ?? 3)));
const QA_CHAR_LIMIT = 400;

const TOPIC_KEY = "session-topic";
const RECENT_KEY = "recent-topic";

/** Explicit env candidates (PI_TOPIC_SUMMARY_MODELS), cheapest first; empty when unset. */
const ENV_MODEL_CANDIDATES = (process.env.PI_TOPIC_SUMMARY_MODELS ?? "")
	.split(",")
	.map((entry) => entry.trim())
	.filter(Boolean)
	.map((entry) => {
		const slash = entry.indexOf("/");
		return slash > 0 ? { provider: entry.slice(0, slash), id: entry.slice(slash + 1) } : undefined;
	})
	.filter((c): c is { provider: string; id: string } => !!c && !!c.id);

// ---------- Topic derivation ----------

/** First readable text line; null when the whole message is fences/noise. */
function firstReadableLine(raw: string): string | null {
	let inFence = false;
	for (const rawLine of raw.split("\n")) {
		const line = rawLine.trim();
		if (line.startsWith("```")) {
			inFence = !inFence;
			continue;
		}
		if (inFence || !line || /^([-=*#]{3,})/.test(line)) continue;
		return line;
	}
	return null;
}

/** Unicode-safe truncation. */
function clamp(s: string, max: number): string {
	const chars = Array.from(s);
	return chars.length <= max ? s : chars.slice(0, max - 1).join("") + "…";
}

/** Cheap LLM-free topic derivation from a user message. */
function deriveTopic(raw: string): string {
	const firstLine = firstReadableLine(raw) ?? raw.replace(/\s+/g, " ").trim();
	let text = firstLine.replace(/`+/g, "").replace(/\s+/g, " ").trim();
	if (!text) text = "untitled";
	return clamp(text, MAX_TOPIC_LEN);
}

/** Topic from the first user message in history (resume/restart case). */
function topicFromHistory(ctx: ExtensionContext): string | undefined {
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "message") continue;
		const msg = entry.message as { role?: string; content?: unknown };
		if (msg?.role !== "user") continue;
		const text = extractText(msg.content);
		if (!text.trim()) continue;
		if (!firstReadableLine(text)) continue;
		return deriveTopic(text);
	}
	return undefined;
}

// ---------- Last-N-turns: Q&A extraction and summarization ----------

/** Plain text from a message content (string or content-block array). */
function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(c): c is { type: "text"; text: string } =>
				typeof c === "object" && c !== null && (c as { type?: string }).type === "text",
		)
		.map((c) => c.text)
		.join("\n");
}

interface QA {
	q: string;
	a: string;
}

/** Collect Q&A rounds from the active branch, last QA_ROUNDS of them. */
function collectRecentQA(ctx: ExtensionContext): QA[] {
	const rounds: QA[] = [];
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const msg = entry.message as { role?: string; content?: unknown };
		if (msg?.role === "user") {
			const q = extractText(msg.content).trim();
			if (q) rounds.push({ q, a: "" });
		} else if (msg?.role === "assistant" && rounds.length > 0) {
			const a = extractText(msg.content).trim();
			if (a) rounds[rounds.length - 1].a = a;
		}
	}
	return rounds.slice(-QA_ROUNDS);
}

function buildSummaryPrompt(qa: QA[]): string {
	const transcript = qa
		.map((r, i) => {
			const q = clamp(r.q.replace(/\s+/g, " "), QA_CHAR_LIMIT);
			const a = r.a ? clamp(r.a.replace(/\s+/g, " "), QA_CHAR_LIMIT) : "(no reply)";
			return `[Round ${i + 1}]\nUser: ${q}\nAssistant: ${a}`;
		})
		.join("\n\n");
	return [
		"You are a session topic labeler. Based on the recent Q&A turns below,",
		"summarize what is actually being worked on right now.",
		"Rules: same language as the conversation; at most 24 characters; a topic",
		"phrase, not a sentence; output only the topic itself — no quotes, no",
		"trailing punctuation, no numbering, no explanations.",
		"",
		"<recent_qa>",
		transcript,
		"</recent_qa>",
	].join("\n");
}

export default function (pi: ExtensionAPI) {
	let sessionTopic = ""; // memory only, never persisted as session name
	let recentTopic = "";
	let pendingSummary = false;
	let runToken = 0;
	let lastLeafId: string | undefined;

	/** Publish both chips; setStatus triggers a re-render by itself. */
	function publishStatuses(ctx: ExtensionContext): void {
		ctx.ui.setStatus(TOPIC_KEY, sessionTopic ? `◆ ${sessionTopic}` : undefined);
		ctx.ui.setStatus(
			RECENT_KEY,
			pendingSummary
				? `Last ${QA_ROUNDS}: …`
				: recentTopic
					? `Last ${QA_ROUNDS}: ${recentTopic}`
					: undefined,
		);
	}

	// ---------- Last-N-turns summary ----------

	/** Pick a summary model — conservative, in order:
	 * 1) PI_TOPIC_SUMMARY_MODELS candidates
	 * 2) the active session model (already in use, zero extra cost).
	 * Never auto-picks from the registry: heuristics can silently select a
	 * paid model the user never intended to call. */
	function pickModel(ctx: ExtensionContext) {
		for (const c of ENV_MODEL_CANDIDATES) {
			const m = ctx.modelRegistry.find(c.provider, c.id);
			if (m && ctx.modelRegistry.hasConfiguredAuth(m)) return m;
		}
		return ctx.model ?? undefined;
	}

	/** Refresh the "Last N" chip. */
	async function summarizeRecent(ctx: ExtensionContext) {
		if (ctx.mode !== "tui") return; // nothing to update without UI
		const leafId = ctx.sessionManager.getLeafId();
		if (leafId && leafId === lastLeafId) return; // no new content
		lastLeafId = leafId;

		const qa = collectRecentQA(ctx);
		if (qa.length === 0) return;

		const token = ++runToken;
		pendingSummary = true;
		publishStatuses(ctx);

		let topic = "";
		try {
			const model = pickModel(ctx);
			if (model) {
				const response = await ctx.modelRegistry.complete(
					model,
					{
						messages: [
							{
								role: "user",
								content: [{ type: "text", text: buildSummaryPrompt(qa) }],
								timestamp: Date.now(),
							},
						],
					},
					{ cacheRetention: "none", sessionId: uuidv7() },
				);
				topic = extractText(response.content)
					.replace(/^["'「『“]+|["'」』”]+$/g, "")
					.replace(/\s+/g, " ")
					.trim();
			}
		} catch {
			// network failure etc.: fall through to the heuristic
		}
		if (!topic) topic = deriveTopic(qa[qa.length - 1].q); // fallback: last user message

		if (token !== runToken) return; // superseded by a newer run; discard
		recentTopic = clamp(topic, MAX_RECENT_LEN);
		pendingSummary = false;
		publishStatuses(ctx);
	}

	// ---------- Events ----------
	// Note: pi.setSessionName() is never called, to avoid pi writing the
	// session name into the terminal tab title.

	// start / new / resume / fork / reload
	pi.on("session_start", async (_event, ctx) => {
		// An even older version of this extension persisted topics as session
		// names (session_info entries), and pi writes session names into the
		// terminal tab on startup/reload/switch. Clear any leftover name
		// immediately (empty name = explicit clear in session-manager), which
		// triggers pi to rewrite the tab as the short default "π - dir".
		if (ctx.mode === "tui" && pi.getSessionName()) {
			pi.setSessionName("");
		}
		sessionTopic = topicFromHistory(ctx) ?? ""; // restore on resume
		lastLeafId = undefined;
		recentTopic = "";
		pendingSummary = false;
		publishStatuses(ctx);
		summarizeRecent(ctx);
	});

	// First user message → derive topic (memory only)
	pi.on("before_agent_start", async (event, ctx) => {
		if (!sessionTopic && event.prompt.trim()) {
			sessionTopic = deriveTopic(event.prompt);
			publishStatuses(ctx);
		}
	});

	// After each settled run → refresh "Last N"
	pi.on("agent_settled", async (_event, ctx) => {
		summarizeRecent(ctx);
	});

	// Set/show/clear the topic manually (memory only)
	pi.registerCommand("topic", {
		description: "Set, show, or clear the session topic (/topic <name> · /topic · /topic clear)",
		handler: async (args, ctx) => {
			const name = args.trim();
			if (name.toLowerCase() === "clear") {
				sessionTopic = "";
				publishStatuses(ctx);
				ctx.ui.notify("Topic cleared", "info");
			} else if (name) {
				sessionTopic = name;
				publishStatuses(ctx);
				ctx.ui.notify(`Topic set to: ${name}`, "info");
			} else {
				ctx.ui.notify(sessionTopic ? `Current topic: ${sessionTopic}` : "No topic set", "info");
			}
		},
	});
}
