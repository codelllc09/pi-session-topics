/**
 * Gap found by the effort A/B experiment's blind review (Y-1): session_start
 * must trigger the first summary on resume (TUI), and must not outside TUI.
 * Fresh extension instance per test — no shared state.
 */
import { test } from "node:test";
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
} from "./helpers.ts";

const SESSION_MODEL = { id: "session-model" };

test("session_start triggers the first summary on resume (TUI)", async () => {
	const pi = await setup();
	const ctx = makeCtx({
		mode: "tui",
		model: SESSION_MODEL,
		branch: [userMsg("How do I rotate logs?"), assistantMsg("Use logrotate")],
	});
	await handler(pi, "session_start")({}, ctx);
	await settle();
	assert.equal(ctx.completeCalls.length, 1);
	const prompt = ctx.completeCalls[0].request.messages[0].content[0].text as string;
	assert.ok(prompt.includes("How do I rotate logs?"));
	assert.equal(lastValue(ctx, RECENT_KEY), "Last 3: summary");
});

test("session_start runs no summary outside TUI mode", async () => {
	const pi = await setup();
	const ctx = makeCtx({
		mode: "headless",
		model: SESSION_MODEL,
		branch: [userMsg("q"), assistantMsg("a")],
	});
	await handler(pi, "session_start")({}, ctx);
	await settle();
	assert.equal(ctx.completeCalls.length, 0);
	assert.equal(lastValue(ctx, RECENT_KEY), undefined);
});
