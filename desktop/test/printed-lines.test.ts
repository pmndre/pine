// What the page keeps of what pine init and the browser's installer print (`addPrinted` in src/text.ts), without a window.
import assert from "node:assert/strict";
import { test } from "node:test";
import { addPrinted } from "../src/text.ts";

const bar = (tenths: number) => `|${"■".repeat(tenths * 8)}${" ".repeat((10 - tenths) * 8)}| ${String(tenths * 10).padStart(3)}% of 129.7 MiB`;

test("a download's progress is one line that counts up, its bar twenty wide", () => {
	const lines: string[] = [];
	for (const line of ["Downloading Chromium", bar(0), bar(1), bar(2), "Chromium downloaded", "Downloading FFMPEG", bar(0), bar(10)]) addPrinted(lines, line);
	assert.deepEqual(lines, ["Downloading Chromium", `|■■■■${" ".repeat(16)}|  20% of 129.7 MiB`, "Chromium downloaded", "Downloading FFMPEG", `|${"■".repeat(20)}| 100% of 129.7 MiB`]);
});

test("any other line is kept as it is, and only the last ones", () => {
	const lines: string[] = [];
	for (const line of ["one", "", "| a table | row |", "50% of the time", "three"]) addPrinted(lines, line, 3);
	assert.deepEqual(lines, ["| a table | row |", "50% of the time", "three"]);
});
