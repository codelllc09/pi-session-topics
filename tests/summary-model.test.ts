/**
 * Summary model selection (pickModel + PI_TOPIC_SUMMARY_MODELS parsing) and
 * the PI_TOPIC_ROUNDS knob. Both are read when the module loads, so this
 * file's process sets them before the first (cached) import.
 *
 * Selection order under test:
 *   1. env candidates, first one with configured auth wins
 *      (slash-less entries are dropped, unauthenticated ones skipped)
 *   2. fallback: the active session model
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
} from "./helpers.ts";

const pi = await setup(undefined, {
	PI_TOPIC_SUMMARY_MODELS: "broken/noauth, junk, good/mid",
	PI_TOPIC_ROUNDS: "2",
});

const SESSION_MODEL = { id: "session-model" };
let leafCounter = 0;

function modelCtx(branch: any[], find: (provider: string, id: string) => unknown, hasAuth: (m: any) => boolean) {
	return makeCtx({
		branch,
		model: SESSION_MODEL,
		leafId: () => `model-leaf-${++leafCounter}`,
		find,
		hasConfiguredAuth: hasAuth,
	});
}

describe("PI_TOPIC_SUMMARY_MODELS candidate handling", () => {
	test("first configured candidate wins; slash-less and unauthenticated entries are skipped", async () => {
		const findCalls: [string, string][] = [];
		const ctx = modelCtx(
			[userMsg("q1"), assistantMsg("a1"), userMsg("q2"), assistantMsg("a2"), userMsg("q3"), assistantMsg("a3")],
			(provider, id) => {
				findCalls.push([provider, id]);
				return { id: `${provider}/${id}` };
			},
			(m) => m?.id === "good/mid",
		);
		await handler(pi, "agent_settled")({}, ctx);
		await settle();
		// "broken/noauth" is found but unauthenticated → skipped; "junk" has no
		// slash → dropped at parse, never queried; "good/mid" is picked.
		assert.deepEqual(findCalls, [
			["broken", "noauth"],
			["good", "mid"],
		]);
		assert.deepEqual(ctx.completeCalls[0].model, { id: "good/mid" });
	});

	test("candidates all unauthenticated → falls back to the session model", async () => {
		const ctx = modelCtx(
			[userMsg("q"), assistantMsg("a")],
			(provider, id) => ({ id: `${provider}/${id}` }),
			() => false,
		);
		await handler(pi, "agent_settled")({}, ctx);
		await settle();
		assert.deepEqual(ctx.completeCalls[0].model, SESSION_MODEL);
	});

	test("candidates unknown to the registry → falls back to the session model", async () => {
		const ctx = modelCtx([userMsg("q"), assistantMsg("a")], () => undefined, () => true);
		await handler(pi, "agent_settled")({}, ctx);
		await settle();
		assert.deepEqual(ctx.completeCalls[0].model, SESSION_MODEL);
	});
});

describe("PI_TOPIC_ROUNDS knob", () => {
	test("rounds=2 keeps the last 2 Q&A rounds and relabels the chip 'Last 2:'", async () => {
		const ctx = modelCtx(
			[userMsg("question 1"), assistantMsg("a"), userMsg("question 2"), assistantMsg("a"), userMsg("question 3"), assistantMsg("a")],
			() => undefined,
			() => true,
		);
		await handler(pi, "agent_settled")({}, ctx);
		await settle();
		const prompt = ctx.completeCalls[0].request.messages[0].content[0].text as string;
		assert.ok(prompt.includes("[Round 1]\nUser: question 2"));
		assert.ok(prompt.includes("[Round 2]\nUser: question 3"));
		assert.ok(!prompt.includes("question 1"));
		// default complete() double returns the text "summary"
		assert.equal(lastValue(ctx, RECENT_KEY), "Last 2: summary");
	});
});
