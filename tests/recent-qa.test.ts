/**
 * Recent Q&A collection (collectRecentQA), summary prompt construction
 * (buildSummaryPrompt) and the summarizeRecent() flow around them, driven
 * through the agent_settled handler with a mocked modelRegistry.
 *
 * QA_ROUNDS defaults to 3 in this process (helpers scrubs PI_TOPIC_ROUNDS);
 * env-knob coverage lives in summary-model.test.ts.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
	RECENT_KEY,
	assistantMsg,
	handler,
	lastValue,
	makeCtx,
	setup,
	settle,
	userMsg,
	values,
} from "./helpers.ts";

// NOTE (from the A/B experiment review): this file shares one extension
// instance and a file-level leaf counter — new tests here inherit that state.
// Prefer a fresh `await setup()` per test (see resume-summary.test.ts).
const pi = await setup();

// summarizeRecent() skips runs whose leaf id is unchanged, so every run in
// this file must see a fresh leaf id (shared counter across tests).
let leafCounter = 0;
const nextLeaf = () => `leaf-${++leafCounter}`;

const SESSION_MODEL = { id: "session-model" };

function qaCtx(
	branch: any[],
	opts: { complete?: any; mode?: string; model?: unknown } = {},
) {
	return makeCtx({
		branch,
		mode: opts.mode,
		model: opts.model === undefined ? SESSION_MODEL : opts.model,
		complete: opts.complete,
		leafId: nextLeaf,
	});
}

/** The summary prompt text captured from the single complete() call. */
const promptOf = (ctx: any) => ctx.completeCalls[0].request.messages[0].content[0].text as string;

async function settleEvent(ctx: any) {
	await handler(pi, "agent_settled")({}, ctx);
	await settle();
}

describe("collectRecentQA — rounds fed into the summary prompt", () => {
	test("one block per Q&A round between <recent_qa> tags", async () => {
		const ctx = qaCtx([userMsg("How do I rotate logs?"), assistantMsg("Use logrotate")]);
		await settleEvent(ctx);
		const prompt = promptOf(ctx);
		assert.match(prompt, /^You are a session topic labeler\./);
		assert.ok(
			prompt.includes(
				"<recent_qa>\n[Round 1]\nUser: How do I rotate logs?\nAssistant: Use logrotate\n</recent_qa>",
			),
			`unexpected prompt:\n${prompt}`,
		);
	});

	test("only the last 3 of 5 rounds are kept, renumbered from Round 1", async () => {
		const branch: any[] = [];
		for (let i = 1; i <= 5; i++) branch.push(userMsg(`question ${i}`), assistantMsg(`answer ${i}`));
		const ctx = qaCtx(branch);
		await settleEvent(ctx);
		const prompt = promptOf(ctx);
		assert.ok(prompt.includes("[Round 1]\nUser: question 3\nAssistant: answer 3\n\n[Round 2]\nUser: question 4\nAssistant: answer 4\n\n[Round 3]\nUser: question 5\nAssistant: answer 5"));
		assert.ok(!prompt.includes("question 1"));
		assert.ok(!prompt.includes("question 2"));
	});

	test("an assistant message before any user message is ignored", async () => {
		const ctx = qaCtx([assistantMsg("orphan answer"), userMsg("real question"), assistantMsg("real answer")]);
		await settleEvent(ctx);
		const prompt = promptOf(ctx);
		assert.ok(!prompt.includes("orphan"));
		assert.ok(prompt.includes("[Round 1]\nUser: real question\nAssistant: real answer"));
	});

	test("a round without an assistant reply renders '(no reply)'", async () => {
		const ctx = qaCtx([userMsg("unanswered question")]);
		await settleEvent(ctx);
		assert.ok(promptOf(ctx).includes("User: unanswered question\nAssistant: (no reply)"));
	});

	test("a later assistant message replaces the earlier one in the same round", async () => {
		const ctx = qaCtx([userMsg("q"), assistantMsg("partial"), assistantMsg("final answer")]);
		await settleEvent(ctx);
		const prompt = promptOf(ctx);
		assert.ok(prompt.includes("Assistant: final answer"));
		assert.ok(!prompt.includes("partial"));
	});

	test("whitespace in questions and answers collapses to single spaces", async () => {
		const ctx = qaCtx([userMsg("line one\nline   two"), assistantMsg("a\tb")]);
		await settleEvent(ctx);
		const prompt = promptOf(ctx);
		assert.ok(prompt.includes("User: line one line two"));
		assert.ok(prompt.includes("Assistant: a b"));
	});

	test("questions and answers clamp to 400 chars (399 + ellipsis)", async () => {
		const ctx = qaCtx([userMsg("x".repeat(500)), assistantMsg("y".repeat(500))]);
		await settleEvent(ctx);
		const prompt = promptOf(ctx);
		assert.ok(prompt.includes(`User: ${"x".repeat(399)}…`));
		assert.ok(prompt.includes(`Assistant: ${"y".repeat(399)}…`));
	});

	test("an empty branch triggers no summary at all", async () => {
		const ctx = qaCtx([]);
		await settleEvent(ctx);
		assert.equal(ctx.completeCalls.length, 0);
		assert.deepEqual(values(ctx, RECENT_KEY), []);
	});
});

describe("summarizeRecent — the modelRegistry.complete call", () => {
	test("uses the session model with no caching and a fresh stub uuidv7 session id", async () => {
		const ctx = qaCtx([userMsg("q"), assistantMsg("a")]);
		await settleEvent(ctx);
		assert.equal(ctx.completeCalls.length, 1);
		const call = ctx.completeCalls[0];
		assert.deepEqual(call.model, SESSION_MODEL);
		// request: a single user message with a timestamp
		assert.equal(call.request.messages.length, 1);
		assert.equal(call.request.messages[0].role, "user");
		assert.equal(typeof call.request.messages[0].timestamp, "number");
		// options: no prompt caching, fresh session id from the pi-ai stub
		assert.equal(call.options.cacheRetention, "none");
		assert.match(call.options.sessionId, /^00000000-0000-7000-8000-\d{12}$/);
	});

	test("model failure falls back to a truncated last question", async () => {
		const ctx = qaCtx([userMsg("B".repeat(50))], {
			complete: async () => {
				throw new Error("network down");
			},
		});
		await settleEvent(ctx);
		// pending chip published first, then the heuristic result (29 B + …)
		assert.deepEqual(values(ctx, RECENT_KEY), ["Last 3: …", `Last 3: ${"B".repeat(29)}…`]);
	});

	test("no model available skips the call and uses the heuristic", async () => {
		const ctx = qaCtx([userMsg("Deploy the service to prod now please")], { model: null });
		await settleEvent(ctx);
		assert.equal(ctx.completeCalls.length, 0);
		const expected = "Deploy the service to prod now please".slice(0, 29) + "…";
		assert.equal(lastValue(ctx, RECENT_KEY), `Last 3: ${expected}`);
	});
});

describe("summarizeRecent — response cleanup and chip rendering", () => {
	test("surrounding CJK/ASCII quotes are stripped from the summary", async () => {
		const ctx = qaCtx([userMsg("q")], {
			complete: async () => ({ content: [{ type: "text", text: "「docker compose deploy」" }] }),
		});
		await settleEvent(ctx);
		assert.equal(lastValue(ctx, RECENT_KEY), "Last 3: docker compose deploy");
	});

	test("a multi-line summary collapses to one line", async () => {
		const ctx = qaCtx([userMsg("q")], {
			complete: async () => ({ content: [{ type: "text", text: '"multi\nline  topic"' }] }),
		});
		await settleEvent(ctx);
		assert.equal(lastValue(ctx, RECENT_KEY), "Last 3: multi line topic");
	});

	test("the summary clamps to 30 chars (29 + ellipsis)", async () => {
		const ctx = qaCtx([userMsg("q")], {
			complete: async () => ({ content: [{ type: "text", text: "z".repeat(40) }] }),
		});
		await settleEvent(ctx);
		assert.equal(lastValue(ctx, RECENT_KEY), `Last 3: ${"z".repeat(29)}…`);
	});
});

describe("summarizeRecent — gates", () => {
	test("non-tui mode never starts a summary", async () => {
		const ctx = qaCtx([userMsg("q"), assistantMsg("a")], { mode: "cli" });
		await settleEvent(ctx);
		assert.equal(ctx.completeCalls.length, 0);
		assert.deepEqual(values(ctx, RECENT_KEY), []);
	});

	test("an unchanged leaf id skips the run entirely", async () => {
		let leaf = "same-leaf";
		const ctx = makeCtx({
			branch: [userMsg("q"), assistantMsg("a")],
			model: SESSION_MODEL,
			leafId: () => leaf,
		});
		await settleEvent(ctx);
		assert.equal(ctx.completeCalls.length, 1);
		assert.deepEqual(values(ctx, RECENT_KEY), ["Last 3: …", "Last 3: summary"]);
		await settleEvent(ctx); // same leaf: no-op
		assert.equal(ctx.completeCalls.length, 1);
		assert.equal(values(ctx, RECENT_KEY).length, 2);
		leaf = "next-leaf";
		await settleEvent(ctx); // changed leaf: runs again
		assert.equal(ctx.completeCalls.length, 2);
		assert.equal(values(ctx, RECENT_KEY).length, 4);
	});
});
