/**
 * Gap found by the effort A/B experiment's blind review (Y-3): branch
 * messages whose content is a block array — text blocks join, non-text
 * blocks are ignored, empty user messages create no round.
 * Fresh extension instance per test — no shared state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	assistantMsg,
	handler,
	makeCtx,
	setup,
	settle,
	userMsg,
} from "./helpers.ts";

let leafCounter = 0;

test("array content: text blocks join, other blocks ignored, empty user skipped", async () => {
	const pi = await setup();
	const ctx = makeCtx({
		model: { id: "session-model" },
		leafId: () => `leaf-${++leafCounter}`,
		branch: [
			userMsg(""),
			assistantMsg("answer with no question"),
			userMsg("img", [
				{ type: "image", source: "data:..." },
				{ type: "text", text: "line one" },
				{ type: "text", text: "line two" },
			]),
			assistantMsg("the answer"),
		],
	});
	await handler(pi, "agent_settled")({}, ctx);
	await settle();
	const prompt = ctx.completeCalls[0].request.messages[0].content[0].text as string;
	assert.ok(prompt.includes("User: line one line two\nAssistant: the answer"));
	assert.ok(!prompt.includes("answer with no question"));
	assert.equal((prompt.match(/\[Round \d+\]/g) ?? []).length, 1);
});
