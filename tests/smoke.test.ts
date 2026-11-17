/**
 * Load canary: the extension must import through the local @earendil-works
 * stubs (tests/hooks.mjs) and register its full pi surface. Guards the
 * test double wiring itself, independently of any behavior.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RECENT_KEY, TOPIC_KEY, handler, lastValue, makeCtx, setup } from "./helpers.ts";

test("loads without the real pi runtime and registers its full surface", async () => {
	const pi = await setup();
	assert.deepEqual(
		[...pi.handlers.keys()].sort(),
		["agent_settled", "before_agent_start", "session_shutdown", "session_start"],
	);
	assert.ok(pi.commands.has("topic"));
	assert.match(pi.commands.get("topic").description, /\/topic/);
});

test("session_start with nothing to show publishes both chips as cleared", async () => {
	const pi = await setup();
	const ctx = makeCtx(); // tui, empty entries/branch, no model
	await handler(pi, "session_start")({}, ctx);
	// one publishStatuses pass: both keys cleared, no summary request fired
	assert.deepEqual(
		ctx.statuses.map((s: any) => s.key),
		[TOPIC_KEY, RECENT_KEY],
	);
	assert.equal(lastValue(ctx, TOPIC_KEY), undefined);
	assert.equal(lastValue(ctx, RECENT_KEY), undefined);
	assert.equal(ctx.completeCalls.length, 0);
});
