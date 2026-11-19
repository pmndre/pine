import assert from "node:assert/strict";
import { test } from "node:test";
import { BANDS, bandEdges, bars, levelsOf } from "./levels.ts";

/** A tone in a wav file: how high, and how loud against the loudest a file can hold. Further tones follow the first. */
type Tone = [hz: number, loud: number];

/**
 * A wav file, 8000 samples a second in one channel of 16 bits unless said otherwise. Without
 * tones it is silence; `sounding` is one tone, several at once, or a list of such parts that
 * follow one another and share the time.
 */
function wav(seconds: number, sounding: Tone | Tone[] | Tone[][] = [], how: { rate?: number; channels?: number; bits?: 16 | 24 | 32; tag?: number } = {}): Buffer {
	const { rate = 8000, channels = 1, bits = 16, tag = bits === 32 ? 3 : 1 } = how;
	const parts: Tone[][] = !sounding.length ? [[]] : typeof sounding[0] === "number" ? [[sounding as Tone]] : typeof (sounding[0] as Tone | Tone[])[0] === "number" ? [sounding as Tone[]] : (sounding as Tone[][]);
	const count = Math.round(seconds * rate);
	const width = bits / 8;
	const data = Buffer.alloc(count * width * channels);
	for (let i = 0; i < count; i++) {
		let v = 0;
		for (const [hz, loud] of parts[Math.min(parts.length - 1, Math.floor((i / count) * parts.length))]) v += loud * Math.sin((2 * Math.PI * hz * i) / rate);
		for (let ch = 0; ch < channels; ch++) {
			const at = (i * channels + ch) * width;
			if (bits === 32) data.writeFloatLE(v, at);
			else data.writeIntLE(Math.round(v * (2 ** (bits - 1) - 1)), at, width);
		}
	}
	const head = Buffer.alloc(44);
	head.write("RIFF", 0, "latin1");
	head.writeUInt32LE(36 + data.length, 4);
	head.write("WAVEfmt ", 8, "latin1");
	head.writeUInt32LE(16, 16);
	head.writeUInt16LE(tag, 20);
	head.writeUInt16LE(channels, 22);
	head.writeUInt32LE(rate, 24);
	head.writeUInt32LE(rate * width * channels, 28);
	head.writeUInt16LE(width * channels, 32);
	head.writeUInt16LE(bits, 34);
	head.write("data", 36, "latin1");
	head.writeUInt32LE(data.length, 40);
	return Buffer.concat([head, data]);
}

/** A file handed over in pieces of an odd size, as a decoder's output arrives. */
async function* pieces(b: Buffer, size = 1021): AsyncGenerator<Buffer> {
	for (let at = 0; at < b.length; at += size) yield b.subarray(at, at + size);
}

/** The band a frequency lies in, for a file with that many samples a second. */
const bandOf = (hz: number, rate: number) => bandEdges(rate).findIndex((edge) => edge > hz) - 1;

/** The bands of a row, and which of them is the loudest. */
const rowOf = (levels: { data: Uint8Array }, row: number) => [...levels.data.subarray(row * BANDS, (row + 1) * BANDS)];

const loudest = (levels: { data: Uint8Array }, row: number) => rowOf(levels, row).indexOf(Math.max(...rowOf(levels, row)));

const FLAT = "▁".repeat(BANDS);

test("sound: the levels of a tone lie in the band of its frequency, and silence is flat", async () => {
	// One tone: a row for every tenth of a second, and in each the tone's band stands out alone.
	const tone = (await levelsOf(pieces(wav(1, [1000, 0.5]))))!;
	assert.equal(`${tone.rows} rows of ${tone.bands}, ${tone.step} s each`, "10 rows of 24, 0.1 s each");
	const at = bandOf(1000, 8000);
	assert.ok(at > 10 && at < 20, `1000 Hz lies in the middle of the row (${at})`);
	for (let row = 0; row < tone.rows; row++) {
		assert.equal(loudest(tone, row), at, `row ${row}`);
		assert.equal(rowOf(tone, row)[at], 255);
		assert.ok(rowOf(tone, row).every((v, band) => Math.abs(band - at) <= 2 || v === 0), `nothing far from the tone (row ${row}: ${rowOf(tone, row)})`);
	}
	assert.equal(bars(tone, 0.3), `${"▁".repeat(at)}█${"▁".repeat(BANDS - at - 1)}`);
	assert.equal(bars(tone, -1), FLAT, "before the start the bars lie flat");
	assert.equal(bars(tone, 1.2), FLAT, "and after the end");

	// Silence is a row of nothing, however long.
	const silence = (await levelsOf(pieces(wav(0.5))))!;
	assert.equal(silence.rows, 5);
	assert.ok(silence.data.every((v) => v === 0));
	assert.equal(bars(silence, 0.2), FLAT);

	// The bars are measured against the sound's own loudest moment: a quiet recording moves as much
	// as a loud one, and a tone 20 decibels under another stands about half as high.
	const quiet = (await levelsOf(pieces(wav(0.3, [1000, 0.004]))))!;
	assert.equal(rowOf(quiet, 1)[at], 255);
	const two = (await levelsOf(pieces(wav(0.3, [[500, 0.5], [2000, 0.05]]))))!;
	assert.equal(rowOf(two, 1)[bandOf(500, 8000)], 255);
	const lower = rowOf(two, 1)[bandOf(2000, 8000)];
	assert.ok(lower > 100 && lower < 170, `the lower tone (${lower})`);

	// Tones that follow one another are found one after the other, and a bar that lost its tone falls, not drops.
	const then = (await levelsOf(pieces(wav(1, [[[500, 0.5]], [[2000, 0.5]]]))))!;
	assert.deepEqual([loudest(then, 2), loudest(then, 8)], [bandOf(500, 8000), bandOf(2000, 8000)]);
	const falling = [5, 6, 7].map((row) => rowOf(then, row)[bandOf(500, 8000)]);
	assert.ok(falling[0] < 255 && falling[0] > falling[1] && falling[1] > falling[2], `the bar of the tone that ended (${falling})`);

	// Other kinds of wav file say the same: two channels of 24 bits at 44100 samples a second, and floating point.
	for (const how of [{ rate: 44100, channels: 2, bits: 24 as const }, { rate: 22050, bits: 32 as const }]) {
		const other = (await levelsOf(pieces(wav(0.4, [3000, 0.3], how), 4099)))!;
		assert.equal(other.rows, 4);
		assert.equal(loudest(other, 2), bandOf(3000, how.rate), JSON.stringify(how));
	}
	// Bare samples, as a decoder writes them, are read without a header.
	const bare = (await levelsOf(pieces(wav(0.3, [1000, 0.5]).subarray(44)), { rate: 8000, channels: 1, bits: 16, float: false }))!;
	assert.equal(loudest(bare, 1), at);

	// What is not samples has no levels: text, a wav file whose sound is compressed, and nothing at all.
	assert.equal(await levelsOf(pieces(Buffer.from("this is only named like a sound"))), undefined);
	assert.equal(await levelsOf(pieces(wav(0.3, [1000, 0.5], { tag: 2 }))), undefined);
	assert.equal(await levelsOf(pieces(Buffer.alloc(0))), undefined);
	assert.equal(await levelsOf(pieces(wav(0))), undefined);
});
