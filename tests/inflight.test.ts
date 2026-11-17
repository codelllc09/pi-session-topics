/**
 * In-flight summary invalidation: session_shutdown and newer runs must
 * discard superseded results instead of publishing them.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
	RECENT_KEY,
	assistantMsg,
	defer,
	handler,
	lastValue,
	makeCtx,
	setup,
	settle,
	userMsg,
	values,
} from "./helpers.ts";

const SESSION_MODEL = { id: "session-model" };

describe("session_shutdown discards an in-flight summary", () => {
	test("the stale result is never published; fresh content still summarizes", async () => {
		const pi = await setup();
		const gate = defer<any>();
		let leaf = 0;
		const leafId = () => `l${++leaf}`;
		const branch = [userMsg("q1"), assistantMsg("a1")];

		const ctx = makeCtx({ branch, model: SESSION_MODEL, leafId, complete: () => gate.promise });
		await handler(pi, "agent_settled")({}, ctx);
		assert.equal(lastValue(ctx, RECENT_KEY), "Last 3: …");

		// session replaced (/new, /fork, /switch, reload) while in flight
		handler(pi, "session_shutdown")();
		gate.release({ content: [{ type: "text", text: "stale summary" }] });
		await settle();
		assert.ok(!values(ctx, RECENT_KEY).includes("Last 3: stale summary"));
		assert.equal(lastValue(ctx, RECENT_KEY), "Last 3: …"); // nothing published after the shutdown

		// after replacement, new content produces a fresh summary
		const ctx2 = makeCtx({
			branch,
			model: SESSION_MODEL,
			leafId, // next leaf id
			complete: async () => ({ content: [{ type: "text", text: "fresh summary" }] }),
		});
		await handler(pi, "agent_settled")({}, ctx2);
		await settle();
		assert.equal(lastValue(ctx2, RECENT_KEY), "Last 3: fresh summary");
	});
});

describe("a newer run supersedes an older in-flight one", () => {
	test("the slow first result is dropped, the fast second one wins", async () => {
		const pi = await setup();
		const gate = defer<any>();
		let first = true;
		let leaf = 0;
		const ctx = makeCtx({
			branch: [userMsg("q"), assistantMsg("a")],
			model: SESSION_MODEL,
			leafId: () => `l${++leaf}`,
			complete: () => {
				if (first) {
					first = false;
					return gate.promise; // slow first run
				}
				return Promise.resolve({ content: [{ type: "text", text: "fast summary" }] });
			},
		});
		await handler(pi, "agent_settled")({}, ctx); // slow run starts (leaf l1)
		await handler(pi, "agent_settled")({}, ctx); // fast run supersedes (leaf l2)
		await settle();
		assert.equal(lastValue(ctx, RECENT_KEY), "Last 3: fast summary");
		// now the slow response arrives late → must be discarded
		gate.release({ content: [{ type: "text", text: "slow summary" }] });
		await settle();
		assert.ok(!values(ctx, RECENT_KEY).includes("Last 3: slow summary"));
		assert.equal(lastValue(ctx, RECENT_KEY), "Last 3: fast summary");
	});
});
