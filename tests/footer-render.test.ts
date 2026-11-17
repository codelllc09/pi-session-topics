/**
 * Footer chip rendering (publishStatuses) and the /topic command, observed
 * through the recorded ctx.ui.setStatus / ctx.ui.notify traffic.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
	RECENT_KEY,
	TOPIC_KEY,
	defer,
	handler,
	lastValue,
	makeCtx,
	makePi,
	setup,
	settle,
	topicCommand,
	userMsg,
} from "./helpers.ts";

const SESSION_MODEL = { id: "session-model" };

describe("session_start — stale session-name clearing", () => {
	test("a leftover session name is cleared exactly once, with empty string", async () => {
		const pi = await setup(makePi("leftover name"));
		await handler(pi, "session_start")({}, makeCtx());
		assert.deepEqual(pi.setSessionNameCalls, [""]);
	});

	test("no session name means no setSessionName call", async () => {
		const pi = await setup(makePi());
		await handler(pi, "session_start")({}, makeCtx());
		assert.deepEqual(pi.setSessionNameCalls, []);
	});

	test("non-tui mode never touches the session name", async () => {
		const pi = await setup(makePi("leftover name"));
		await handler(pi, "session_start")({}, makeCtx({ mode: "cli" }));
		assert.deepEqual(pi.setSessionNameCalls, []);
	});
});

describe("session_start — topic lifecycle across sessions", () => {
	test("history restores the topic chip", async () => {
		const pi = await setup();
		const ctx = makeCtx({ entries: [userMsg("Historic topic")] });
		await handler(pi, "session_start")({}, ctx);
		assert.equal(lastValue(ctx, TOPIC_KEY), "◆ Historic topic");
	});

	test("a new session without history clears a previously derived topic", async () => {
		const pi = await setup();
		const first = makeCtx({ entries: [userMsg("Historic topic")] });
		await handler(pi, "session_start")({}, first);
		assert.equal(lastValue(first, TOPIC_KEY), "◆ Historic topic");
		const second = makeCtx({ entries: [] });
		await handler(pi, "session_start")({}, second);
		await settle();
		assert.equal(lastValue(second, TOPIC_KEY), undefined);
	});
});

describe("chip states around a live summary", () => {
	test("topic chip stays put while the recent chip goes pending → done", async () => {
		const pi = await setup();
		const gate = defer<any>();
		let leaf = 0;
		const ctx = makeCtx({
			branch: [userMsg("what is the build failing?"), userMsg("what is the build failing?")],
			entries: [userMsg("what is the build failing?")],
			model: SESSION_MODEL,
			leafId: () => `l${++leaf}`,
			complete: () => gate.promise,
		});
		// topic derived from the first user message (history + prompt agree)
		await handler(pi, "before_agent_start")({ messageType: "user", prompt: "what is the build failing?" }, ctx);
		assert.equal(lastValue(ctx, TOPIC_KEY), "◆ what is the build failing?");
		// settle → pending ellipsis, topic untouched
		await handler(pi, "agent_settled")({}, ctx);
		assert.equal(lastValue(ctx, TOPIC_KEY), "◆ what is the build failing?");
		assert.equal(lastValue(ctx, RECENT_KEY), "Last 3: …");
		// release the model response → done
		gate.release({ content: [{ type: "text", text: "fixing lint errors" }] });
		await settle();
		assert.equal(lastValue(ctx, TOPIC_KEY), "◆ what is the build failing?");
		assert.equal(lastValue(ctx, RECENT_KEY), "Last 3: fixing lint errors");
	});
});

describe("the /topic command", () => {
	test("set → chip + info notification", async () => {
		const pi = await setup();
		const ctx = makeCtx();
		await topicCommand(pi)("kubernetes migration", ctx);
		assert.equal(lastValue(ctx, TOPIC_KEY), "◆ kubernetes migration");
		assert.deepEqual(ctx.notifyCalls.at(-1), { msg: "Topic set to: kubernetes migration", level: "info" });
	});

	test("show (empty arg) reports the current topic without re-rendering", async () => {
		const pi = await setup();
		const ctx = makeCtx();
		await topicCommand(pi)("kubernetes migration", ctx);
		const statusCount = ctx.statuses.length;
		await topicCommand(pi)("", ctx);
		await topicCommand(pi)("   ", ctx); // trimmed to empty → also 'show'
		assert.equal(ctx.statuses.length, statusCount);
		assert.deepEqual(ctx.notifyCalls.at(-1), { msg: "Current topic: kubernetes migration", level: "info" });
	});

	test("clear (case-insensitive, extra whitespace) unsets the chip", async () => {
		const pi = await setup();
		const ctx = makeCtx();
		await topicCommand(pi)("kubernetes migration", ctx);
		await topicCommand(pi)("  CLEAR  ", ctx);
		assert.equal(lastValue(ctx, TOPIC_KEY), undefined);
		assert.deepEqual(ctx.notifyCalls.at(-1), { msg: "Topic cleared", level: "info" });
	});

	test("show with no topic set says so", async () => {
		const pi = await setup();
		const ctx = makeCtx();
		await topicCommand(pi)("", ctx);
		assert.deepEqual(ctx.notifyCalls.at(-1), { msg: "No topic set", level: "info" });
	});

	test("after clear, the next user prompt re-derives the topic", async () => {
		const pi = await setup();
		const ctx = makeCtx();
		await handler(pi, "session_start")({}, ctx); // topic empty
		await topicCommand(pi)("clear", ctx);
		await handler(pi, "before_agent_start")({ messageType: "user", prompt: "new direction" }, ctx);
		assert.equal(lastValue(ctx, TOPIC_KEY), "◆ new direction");
	});
});
