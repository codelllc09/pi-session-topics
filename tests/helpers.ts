/**
 * Shared test doubles for the session-title extension.
 *
 * The extension keeps its helpers private, so tests drive it through the
 * public surface: the default export plus the event handlers / command it
 * registers on a mock `pi`. The @earendil-works/* peer packages are
 * replaced by tests/hooks.mjs, so nothing touches the real pi runtime.
 *
 * PI_TOPIC_* env constants are read when the module loads, so
 * loadExtension() scrubs/sets them *before* the (per-process cached)
 * dynamic import.
 */
import { register } from "node:module";
import assert from "node:assert/strict";

// Register the stub resolver before any import of ../session-title.ts.
register(new URL("./hooks.mjs", import.meta.url));

export const TOPIC_KEY = "session-topic";
export const RECENT_KEY = "recent-topic";

export interface StatusEntry {
	key: string;
	value: string | undefined;
}
export interface NotifyCall {
	msg: string;
	level: string;
}
export interface CompleteCall {
	model: unknown;
	request: any;
	options: any;
}
/** A pi session entry carrying a message (shape used by getEntries/getBranch). */
export interface SessionEntry {
	type: string;
	message: { role: string; content: unknown };
}

/**
 * Load the extension with deterministic env. Call once per test file; the
 * module is cached per process, so pass every env override up front.
 */
export async function loadExtension(env: Record<string, string> = {}): Promise<(pi: any) => void> {
	delete process.env.PI_TOPIC_SUMMARY_MODELS;
	delete process.env.PI_TOPIC_ROUNDS;
	for (const [key, value] of Object.entries(env)) process.env[key] = value;
	return (await import("../session-title.ts")).default;
}

/** Mock ExtensionAPI capturing registered events, commands and session-name calls. */
export function makePi(sessionName?: string) {
	const handlers = new Map<string, (event?: any, ctx?: any) => any>();
	const commands = new Map<string, { description: string; handler: (args: string, ctx: any) => any }>();
	const setSessionNameCalls: string[] = [];
	let name = sessionName;
	return {
		handlers,
		commands,
		setSessionNameCalls,
		on: (event: string, handler: any) => handlers.set(event, handler),
		registerCommand: (commandName: string, def: any) => commands.set(commandName, def),
		getSessionName: () => name,
		setSessionName: (value: string) => {
			setSessionNameCalls.push(value);
			name = value;
		},
	};
}

export interface CtxOptions {
	mode?: string;
	/** sessionManager.getEntries() — topic restore on session_start. */
	entries?: SessionEntry[];
	/** sessionManager.getBranch() — Q&A input for the summary. */
	branch?: SessionEntry[];
	leafId?: () => string | undefined;
	model?: unknown;
	complete?: (model: unknown, request: any, options: any) => any;
	find?: (provider: string, id: string) => unknown;
	hasConfiguredAuth?: (model: unknown) => boolean;
}

/** Mock ExtensionContext recording setStatus/notify/complete traffic. */
export function makeCtx(options: CtxOptions = {}) {
	const statuses: StatusEntry[] = [];
	const notifyCalls: NotifyCall[] = [];
	const completeCalls: CompleteCall[] = [];
	const complete =
		options.complete ?? (async () => ({ content: [{ type: "text", text: "summary" }] }));
	return {
		mode: options.mode ?? "tui",
		statuses,
		notifyCalls,
		completeCalls,
		sessionManager: {
			getEntries: () => options.entries ?? [],
			getBranch: () => options.branch ?? [],
			getLeafId: () => (options.leafId ? options.leafId() : undefined),
		},
		modelRegistry: {
			find: options.find ?? (() => undefined),
			hasConfiguredAuth: options.hasConfiguredAuth ?? (() => true),
			complete: (model: unknown, request: any, opts: any) => {
				completeCalls.push({ model, request, options: opts });
				return complete(model, request, opts);
			},
		},
		model: options.model,
		ui: {
			setStatus: (key: string, value: string | undefined) => statuses.push({ key, value }),
			notify: (msg: string, level: string) => notifyCalls.push({ msg, level }),
		},
	};
}

/** Instantiate the extension on a fresh mock pi. */
export async function setup(pi = makePi(), env: Record<string, string> = {}) {
	const extension = await loadExtension(env);
	extension(pi);
	return pi;
}

/** The extension's registered handler for an event, asserted present. */
export function handler(pi: any, event: string): (event?: any, ctx?: any) => any {
	const h = pi.handlers.get(event);
	assert.ok(h instanceof Function, `event "${event}" is not registered`);
	return h;
}

/** The extension's registered /topic command handler, asserted present. */
export function topicCommand(pi: any): (args: string, ctx: any) => any {
	const def = pi.commands.get("topic");
	assert.ok(def?.handler instanceof Function, 'command "topic" is not registered');
	return def.handler;
}

function msgEntry(role: string, text: string, content?: unknown): SessionEntry {
	return { type: "message", message: { role, content: content ?? text } };
}
export const userMsg = (text: string, content?: unknown) => msgEntry("user", text, content);
export const assistantMsg = (text: string, content?: unknown) => msgEntry("assistant", text, content);

/** All recorded values for one status key, in order. */
export function values(ctx: any, key: string): (string | undefined)[] {
	return ctx.statuses.filter((s: StatusEntry) => s.key === key).map((s: StatusEntry) => s.value);
}
/** Last recorded value for one status key. */
export function lastValue(ctx: any, key: string): string | undefined {
	const list = values(ctx, key);
	return list[list.length - 1];
}

/** Let the fire-and-forget summarizeRecent() promise chains run out. */
export async function settle(rounds = 8): Promise<void> {
	for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

/** A promise the test resolves manually, for probing in-flight summaries. */
export function defer<T>() {
	let release!: (value: T) => void;
	const promise = new Promise<T>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}
