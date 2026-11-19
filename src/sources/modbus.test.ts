import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { readings } from "./modbus.ts";
import { harness, sleep, until } from "../../testing/harness.ts";

const eventsOf = (h: any, name: string): any[] => h.pine.bus.query({ topic: `source/${name}/#` }).sort((a: any, b: any) => a.id - b.id);

const infoOf = (h: any, name: string) => h.pine.sources.list().find((s: any) => s.name === name)!;

/** A Modbus TCP device whose registers the test changes. It answers the four reading functions and counts everything else. */
async function device() {
	const state = {
		holding: new Map<number, number>(),
		input: new Map<number, number>(),
		coil: new Map<number, boolean>(),
		discrete: new Map<number, boolean>(),
		/** address → the exception it answers with */
		exception: new Map<number, number>(),
		down: false,
		asked: [] as Array<{ fc: number; unit: number; address: number; count: number }>,
	};
	const server = net.createServer((sock) => {
		if (state.down) return void sock.destroy();
		let buf = Buffer.alloc(0);
		sock.on("error", () => {});
		sock.on("data", (d: Buffer) => {
			buf = Buffer.concat([buf, d]);
			while (buf.length >= 12) {
				const frame = buf.subarray(0, 12);
				buf = buf.subarray(12);
				const [tid, unit, fc, address, count] = [frame.readUInt16BE(0), frame[6], frame[7], frame.readUInt16BE(8), frame.readUInt16BE(10)];
				state.asked.push({ fc, unit, address, count });
				const answer = (pdu: Buffer) => {
					const head = Buffer.alloc(7);
					head.writeUInt16BE(tid, 0);
					head.writeUInt16BE(pdu.length + 1, 4);
					head[6] = unit;
					sock.write(Buffer.concat([head, pdu]));
				};
				if (state.exception.has(address)) answer(Buffer.from([fc | 0x80, state.exception.get(address)!]));
				else if (fc === 3 || fc === 4) {
					const data = Buffer.alloc(count * 2);
					for (let i = 0; i < count; i++) data.writeUInt16BE((fc === 3 ? state.holding : state.input).get(address + i) ?? 0, i * 2);
					answer(Buffer.concat([Buffer.from([fc, data.length]), data]));
				} else if (fc === 1 || fc === 2) answer(Buffer.from([fc, 1, (fc === 1 ? state.coil : state.discrete).get(address) ? 1 : 0]));
				else answer(Buffer.from([fc | 0x80, 1]));
			}
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return { state, port: (server.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("modbus: types, scale and word order are read as the device means them; a value is reported when it moved a step", async (t) => {
	const dev = await device();
	t.after(() => dev.close());
	const { holding, input, coil, discrete } = dev.state;
	holding.set(10, 0x10000 - 1500); // i16: -1500
	input.set(20, 215); // tenths
	holding.set(30, 0x0001).set(31, 0x86a0); // u32, high word first: 100000
	holding.set(40, 0xfffe).set(41, 0xffff); // i32, low word first: -2
	const f = Buffer.alloc(4);
	f.writeFloatBE(230.5);
	holding.set(50, f.readUInt16BE(0)).set(51, f.readUInt16BE(2));
	coil.set(5, true);
	discrete.set(6, false);
	const h = await harness({
		pine: {
			sources: {
				meter: {
					type: "modbus", host: "127.0.0.1", port: dev.port, unit: 7, every: "40ms", start: "always",
					read: [
						{ name: "power", address: 10, type: "i16", step: 100 },
						{ name: "temp", address: 20, kind: "input", scale: 0.1 },
						{ name: "energy", address: 30, type: "u32" },
						{ name: "total", address: 40, type: "i32", words: "le" },
						{ name: "volts", address: 50, type: "f32" },
						{ name: "pump", address: 5, kind: "coil" },
						{ name: "door", address: 6, kind: "discrete" },
					],
				},
			},
		},
		agents: { main: {} },
	});
	const events = () => eventsOf(h, "meter").map((e: any) => e.payload);
	const info = () => infoOf(h, "meter");

	// The starting point: read, remembered, nothing reported.
	await until(() => /^last looked/.test(info().status ?? ""), 4000, "the first look");
	await sleep(120);
	assert.equal(events().length, 0, "the first look is the starting point");
	assert.match(info().status!, /7 values: power -1500, temp 21\.5, energy 100000, total -2, \.\.\.$/);
	assert.ok(dev.state.asked.every((a) => a.unit === 7 && a.fc >= 1 && a.fc <= 4), "only the reading functions are ever sent, to the unit that was named");
	assert.deepEqual([...new Set(dev.state.asked.filter((a) => a.address === 30 || a.address === 10).map((a) => `${a.fc}:${a.address}:${a.count}`))].sort(), ["3:10:1", "3:30:2"]);

	// Less than a step: quiet. A step from what was last reported, not from what was last read: reported once.
	holding.set(10, 0x10000 - 1450);
	await sleep(150);
	holding.set(10, 0x10000 - 1380);
	input.set(20, 216);
	coil.set(5, false);
	f.writeFloatBE(231.25);
	holding.set(50, f.readUInt16BE(0)).set(51, f.readUInt16BE(2));
	await until(() => events().length === 4, 4000, "the changes");
	assert.deepEqual(
		events().sort((a: any, b: any) => a.name.localeCompare(b.name)),
		[
			{ name: "power", value: -1380, previous: -1500 },
			{ name: "pump", value: false, previous: true },
			{ name: "temp", value: 21.6, previous: 21.5 },
			{ name: "volts", value: 231.25, previous: 230.5 },
		],
	);
	assert.equal(eventsOf(h, "meter")[0].trust, "untrusted");
	await sleep(150);
	assert.equal(events().length, 4, "and then it is quiet again");

	// The device says no to one register: a failed look that says which value and why, not an event.
	dev.state.exception.set(20, 2);
	await until(() => /failing since .*the device says: illegal data address \(2\) for temp/.test(info().status ?? ""), 4000, "the exception to show");
	dev.state.exception.clear();
	await until(() => /^last looked/.test(info().status ?? ""), 4000, "it to work again");
	// Down, and back with another value: the failure shows, the change is reported when it is back.
	dev.state.down = true;
	await until(() => /failing since .*it closed the connection/.test(info().status ?? ""), 4000, "down to show");
	assert.equal(info().running, true);
	input.set(20, 220);
	dev.state.down = false;
	await until(() => events().length === 5, 6000, "what changed meanwhile");
	assert.deepEqual(events().at(-1), { name: "temp", value: 22, previous: 21.6 });
	await h.close();
});

test("modbus: a list of values that cannot work is refused with what to give instead", () => {
	assert.deepEqual(readings([{ name: "a", address: 0 }]), [{ name: "a", address: 0, kind: "holding", type: "u16", scale: 1, words: "be" }]);
	assert.deepEqual(readings([{ name: "on", address: 3, kind: "coil", type: "f32", step: 2 }])[0], { name: "on", address: 3, kind: "coil", type: "bit", scale: 1, words: "be" });
	for (const [raw, re] of [
		[[], /needs "read"/],
		[[{ name: "a", address: 70000 }], /counted from 0, up to 65535\. A list that counts from 40001/],
		[[{ name: "a", address: 65535, type: "u32" }], /up to 65535/],
		[[{ name: "a", address: 1 }, { name: "a", address: 2 }], /two values are called "a"/],
		[[{ name: "a b", address: 1 }], /"name" is a short word/],
		[[{ name: "a", address: 1, type: "u64" }], /"type" is u16, i16, u32, i32 or f32/],
		[[{ name: "a", address: 1, kind: "register" }], /"kind" is holding, input, coil or discrete/],
		[[{ name: "a", address: 1, scale: 0 }], /"scale"/],
		[[{ name: "a", address: 1, step: -1 }], /"step"/],
		[Array.from({ length: 33 }, (_, i) => ({ name: `v${i}`, address: i })), /32 values at most/],
	] as Array<[unknown, RegExp]>) assert.throws(() => readings(raw), re);
});
