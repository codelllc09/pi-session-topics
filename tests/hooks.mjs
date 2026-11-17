/**
 * Module-resolution hook for tests: replaces the @earendil-works/* peer
 * packages with local stubs, so importing ../session-title.ts works
 * without the real pi runtime, node_modules, or network access.
 */
const STUBS = new Map([
	["@earendil-works/pi-ai", new URL("./stubs/pi-ai.mjs", import.meta.url).href],
	["@earendil-works/pi-coding-agent", new URL("./stubs/pi-coding-agent.mjs", import.meta.url).href],
]);

export async function resolve(specifier, context, nextResolve) {
	const url = STUBS.get(specifier);
	if (url) return { url, shortCircuit: true };
	return nextResolve(specifier, context);
}
