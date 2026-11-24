// A reporter for `node --test` that prints nothing and notes the files in which a test failed, one
// a line, in the file PINE_DESKTOP_FAILED names: scripts/test.mjs runs those again, alone (and so
// does the root's scripts/test.mjs for pine's own tests). Written
// as each failure comes, not at the end, since a run with --test-force-exit ends without waiting.
import fs from "node:fs";

export default async function* failedFiles(source) {
	const into = process.env.PINE_DESKTOP_FAILED;
	const seen = new Set();
	for await (const event of source) {
		const file = event.type === "test:fail" ? event.data?.file : undefined;
		if (!into || !file || seen.has(file)) continue;
		seen.add(file);
		fs.appendFileSync(into, `${file}\n`);
	}
}
