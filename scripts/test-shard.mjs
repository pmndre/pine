// The test files of one shard, for the Test workflow, where each shard runs on a runner of its own.
// node's own `--test-shard` deals the files out in turn by their place in the list, which leaves
// one shard with twice the work of another when long files happen to fall together. Here the files
// are dealt by how long they took: the longest first, each onto the shard that has the least so far.
// The durations are seconds per file from a macOS run of the workflow (test-durations.json); a file
// that has none counts as the median, and a file listed there that no longer exists is ignored.
//   node scripts/test-shard.mjs <shard> <count>     the files of shard <shard> of <count>, one a line
//   node scripts/test-shard.mjs --refresh <report.xml>...
//
// To refresh the durations when files are added or grow: run the suite with node's JUnit reporter,
// on a Mac, and hand the report over. The proportions are what count, not the exact seconds.
//   node --test --test-force-exit --test-reporter=junit --test-reporter-destination=report.xml "test/*.test.ts"
//   node scripts/test-shard.mjs --refresh report.xml
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const durationsFile = path.join(import.meta.dirname, "test-durations.json");
const args = process.argv.slice(2);

if (args[0] === "--refresh") {
	/** Seconds per file, added up over the file's tests in each report. */
	const seconds = {};
	for (const report of args.slice(1)) {
		for (const [, time, file] of fs.readFileSync(report, "utf8").matchAll(/<testcase [^>]*time="([\d.]+)"[^>]*file="([^"]+)"/g)) {
			const name = path.basename(file);
			seconds[name] = (seconds[name] ?? 0) + Number(time);
		}
	}
	const rounded = Object.fromEntries(Object.keys(seconds).sort().map((name) => [name, Math.round(seconds[name])]));
	fs.writeFileSync(durationsFile, `${JSON.stringify(rounded, null, "\t")}\n`);
	console.log(`${Object.keys(rounded).length} files written to ${path.relative(root, durationsFile)}.`);
	process.exit(0);
}

const shard = Number(args[0]);
const count = Number(args[1]);
if (!Number.isInteger(shard) || !Number.isInteger(count) || shard < 1 || shard > count) {
	console.error("usage: node scripts/test-shard.mjs <shard> <count>, with 1 <= shard <= count");
	process.exit(2);
}

const durations = JSON.parse(fs.readFileSync(durationsFile, "utf8"));
const files = fs.readdirSync(path.join(root, "test")).filter((f) => f.endsWith(".test.ts")).sort();
const known = files.filter((f) => f in durations).map((f) => durations[f]).sort((a, b) => a - b);
const median = known.length ? known[Math.floor(known.length / 2)] : 1;
const cost = (file) => durations[file] ?? median;

// Longest first; a tie goes by name, so that every runner works the shards out the same way.
const shards = Array.from({ length: count }, () => ({ files: [], seconds: 0 }));
for (const file of [...files].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b))) {
	const lightest = shards.reduce((least, s) => (s.seconds < least.seconds ? s : least));
	lightest.files.push(file);
	lightest.seconds += cost(file);
}

const mine = shards[shard - 1];
// An empty shard would make `node --test` run every file: that is an error, not a shard.
if (!mine.files.length) {
	console.error(`Shard ${shard} of ${count} has no files.`);
	process.exit(1);
}
console.error(`Shard ${shard} of ${count}: ${mine.files.length} files, about ${mine.seconds}s on the macOS run the durations come from.`);
for (const file of mine.files.sort()) console.log(`test/${file}`);
