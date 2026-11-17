/**
 * Deterministic stand-in for @earendil-works/pi-ai's uuidv7().
 * Recognizable shape: 00000000-0000-7... lets tests assert that the
 * summary request really got a fresh session id from this stub.
 */
let counter = 0;

export function uuidv7() {
	counter += 1;
	return `00000000-0000-7000-8000-${String(counter).padStart(12, "0")}`;
}
