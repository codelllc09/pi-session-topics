/**
 * Topic derivation and truncation: deriveTopic / firstReadableLine / clamp,
 * driven through the before_agent_start handler (topic chip) and the
 * session_start handler (topicFromHistory).
 *
 * The extension instance is shared per process; session_start with an empty
 * history resets the in-memory topic before each case.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { TOPIC_KEY, handler, lastValue, makeCtx, setup, userMsg, values } from "./helpers.ts";

/** Fire session_start (reset) + before_agent_start; return the topic chip. */
async function derive(prompt: string, messageType = "user"): Promise<string | undefined> {
	const pi = await setup();
	const ctx = makeCtx(); // no history, no branch, no model
	await handler(pi, "session_start")({}, ctx);
	await handler(pi, "before_agent_start")({ messageType, prompt }, ctx);
	return lastValue(ctx, TOPIC_KEY);
}

describe("deriveTopic — line selection (firstReadableLine)", () => {
	test("plain first line becomes the topic chip", async () => {
		assert.equal(await derive("Fix the login bug"), "◆ Fix the login bug");
	});

	test("only the first readable line is used", async () => {
		assert.equal(await derive("Set up the database\nthen the API"), "◆ Set up the database");
	});

	test("leading blank lines are skipped", async () => {
		assert.equal(await derive("\n\n   \nActual task"), "◆ Actual task");
	});

	test("leading code fence content is skipped", async () => {
		assert.equal(await derive("```\nSELECT 1\n```\nExplain this query"), "◆ Explain this query");
	});

	test("horizontal-rule and heading noise lines are skipped", async () => {
		assert.equal(await derive("---\n### Title\nWrite the README"), "◆ Write the README");
	});

	test("markdown heading alone never becomes the topic", async () => {
		assert.equal(await derive("### Header\nactual task"), "◆ actual task");
	});

	test("unclosed fence falls back to the collapsed raw text", async () => {
		// firstReadableLine returns null; fallback strips backticks + collapses ws
		assert.equal(await derive("```\ncode body"), "◆ code body");
	});
});

describe("deriveTopic — text normalization", () => {
	test("inline backticks are removed", async () => {
		assert.equal(await derive("rename `old_fn` to `new_fn`"), "◆ rename old_fn to new_fn");
	});

	test("runs of whitespace collapse to single spaces", async () => {
		assert.equal(await derive("what   is\tthis?\nnext"), "◆ what is this?");
	});

	test("a prompt that reduces to nothing becomes 'untitled'", async () => {
		assert.equal(await derive("```"), "◆ untitled");
	});
});

describe("deriveTopic — clamping to 40 chars (clamp)", () => {
	test("45 chars truncate to 39 chars + ellipsis", async () => {
		assert.equal(await derive("A".repeat(45)), `◆ ${"A".repeat(39)}…`);
	});

	test("exactly 40 chars are kept verbatim (no ellipsis)", async () => {
		assert.equal(await derive("A".repeat(40)), `◆ ${"A".repeat(40)}`);
	});

	test("CJK characters clamp by code point, not UTF-16 unit", async () => {
		assert.equal(await derive("端".repeat(41)), `◆ ${"端".repeat(39)}…`);
	});

	test("astral-plane emoji clamp by code point", async () => {
		const chip = await derive("😀".repeat(41));
		assert.equal(chip, `◆ ${"😀".repeat(39)}…`);
		// topic part = 39 emoji + ellipsis = 40 code points, not 79 UTF-16 units
		assert.equal(Array.from((chip as string).slice(2)).length, 40);
		assert.notEqual((chip as string).slice(2).length, 40); // each emoji is 2 UTF-16 units
	});
});

describe("deriveTopic — guard rails", () => {
	test("whitespace-only prompt does not set or clear the chip", async () => {
		const pi = await setup();
		const ctx = makeCtx();
		await handler(pi, "session_start")({}, ctx); // baseline publish: undefined
		await handler(pi, "before_agent_start")({ messageType: "user", prompt: "   " }, ctx);
		assert.deepEqual(values(ctx, TOPIC_KEY), [undefined]);
	});

	test("non-user message types are ignored", async () => {
		const pi = await setup();
		const ctx = makeCtx();
		await handler(pi, "session_start")({}, ctx);
		await handler(pi, "before_agent_start")({ messageType: "custom", prompt: "ignored" }, ctx);
		assert.deepEqual(values(ctx, TOPIC_KEY), [undefined]);
	});

	test("an already-derived topic is not overwritten by later prompts", async () => {
		const pi = await setup();
		const ctx = makeCtx();
		await handler(pi, "session_start")({}, ctx);
		await handler(pi, "before_agent_start")({ messageType: "user", prompt: "first task" }, ctx);
		await handler(pi, "before_agent_start")({ messageType: "user", prompt: "second task" }, ctx);
		assert.equal(lastValue(ctx, TOPIC_KEY), "◆ first task");
	});
});

describe("topicFromHistory — topic restore on session_start", () => {
	async function restoredWith(entries: any[]): Promise<string | undefined> {
		const pi = await setup();
		const ctx = makeCtx({ entries });
		await handler(pi, "session_start")({}, ctx);
		return lastValue(ctx, TOPIC_KEY);
	}

	test("first user message in entries wins", async () => {
		assert.equal(
			await restoredWith([
				{ type: "session_info", message: { role: "user", content: "meta" } },
				userMsg("Restore this topic"),
				userMsg("later question"),
			]),
			"◆ Restore this topic",
		);
	});

	test("assistant messages are skipped", async () => {
		assert.equal(
			await restoredWith([{ type: "message", message: { role: "assistant", content: "a reply" } }]),
			undefined,
		);
	});

	test("text is extracted from content-block arrays", async () => {
		assert.equal(
			await restoredWith([
				userMsg("", [
					{ type: "text", text: "Array content question" },
					{ type: "image", source: "x" },
				]),
			]),
			"◆ Array content question",
		);
	});

	test("unreadable (fence-only) first user message is skipped for the next one", async () => {
		assert.equal(
			await restoredWith([userMsg("```"), userMsg("Second question")]),
			"◆ Second question",
		);
	});

	test("empty user content is skipped", async () => {
		assert.equal(await restoredWith([userMsg("   "), userMsg("Real question")]), "◆ Real question");
	});

	test("no user messages leaves the chip unset", async () => {
		assert.equal(await restoredWith([]), undefined);
	});
});
