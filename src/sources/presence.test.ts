import assert from "node:assert/strict";
import { test } from "node:test";
import { browseLine, dnsQuery, dnsRead, timing as netTiming, tracker } from "./presence.ts";
import { harness, sleep, until } from "../../testing/harness.ts";

const eventsOf = (h: any, name: string): any[] => h.pine.bus.query({ topic: `source/${name}/#` }).sort((a: any, b: any) => a.id - b.id);

const infoOf = (h: any, name: string) => h.pine.sources.list().find((s: any) => s.name === name)!;

test("presence: an announcement is read with its compressed names, a goodbye is one, and nonsense ends the reading", () => {
	const label = (s: string) => Buffer.concat([Buffer.from([Buffer.byteLength(s)]), Buffer.from(s)]);
	const full = (s: string) => Buffer.concat([...s.split(".").map(label), Buffer.from([0])]);
	const to = (offset: number) => Buffer.from([0xc0 | (offset >> 8), offset & 0xff]);
	const parts: Buffer[] = [];
	const at = () => parts.reduce((n, b) => n + b.length, 0);
	const record = (name: Buffer, type: number, ttl: number, data: Buffer) => {
		const head = Buffer.alloc(10);
		head.writeUInt16BE(type, 0);
		head.writeUInt16BE(1, 2);
		head.writeUInt32BE(ttl, 4);
		head.writeUInt16BE(data.length, 8);
		parts.push(name, head, data);
	};
	const head = Buffer.alloc(12);
	head.writeUInt16BE(0x8400, 2);
	head.writeUInt16BE(2, 6);
	head.writeUInt16BE(2, 10);
	parts.push(head);
	const service = at(); // "_ipp._tcp.local" is written once and pointed at from then on
	const local = service + 1 + 4 + 1 + 4;
	record(full("_ipp._tcp.local"), 12, 4500, Buffer.concat([label("Office Printer"), to(service)]));
	const instance = at() - (1 + 14 + 2);
	record(to(service), 12, 0, Buffer.concat([label("Old Printer"), to(service)]));
	const srv = Buffer.alloc(6);
	srv.writeUInt16BE(631, 4);
	const target = at() + 2 + 10 + 6;
	record(to(instance), 33, 120, Buffer.concat([srv, label("printer"), to(local)]));
	record(to(target), 1, 120, Buffer.from([192, 168, 1, 77]));
	const { response, records } = dnsRead(Buffer.concat(parts));
	assert.equal(response, true);
	assert.deepEqual(records, [
		{ name: ["_ipp", "_tcp", "local"], type: 12, ttl: 4500, ptr: ["Office Printer", "_ipp", "_tcp", "local"] },
		{ name: ["_ipp", "_tcp", "local"], type: 12, ttl: 0, ptr: ["Old Printer", "_ipp", "_tcp", "local"] },
		{ name: ["Office Printer", "_ipp", "_tcp", "local"], type: 33, ttl: 120, srv: { port: 631, target: ["printer", "local"] } },
		{ name: ["printer", "local"], type: 1, ttl: 120, address: "192.168.1.77" },
	]);

	// A question is not an answer, and reads back as what was asked.
	const q = dnsQuery(["_ipp._tcp.local", "_airplay._tcp.local"], true);
	assert.deepEqual([q.readUInt16BE(4), dnsRead(q)], [2, { response: false, records: [] }]);
	assert.equal(q.readUInt16BE(q.length - 2), 0x8001, "an answer to the asker alone is asked for");
	// A name that points at itself, a message that ends early, a length that leads out of it: no loop, no error.
	const loop = Buffer.concat([head, to(12), Buffer.alloc(10)]);
	assert.deepEqual(dnsRead(loop).records, []);
	assert.deepEqual(dnsRead(Buffer.concat(parts).subarray(0, 40)).records, []);
	assert.equal(dnsRead(Buffer.concat(parts).subarray(0, at() - 3)).records.length, 3);
	assert.deepEqual(dnsRead(Buffer.from([1, 2, 3])), { response: false, records: [] });

	// On a Mac the system's own browser is asked instead: a line of it is a device that came or went, on one interface.
	assert.deepEqual(browseLine(" 0:40:37.908  Add        3  26 local.               _airplay._tcp.       Living Room TV"), { add: true, iface: "26", service: "_airplay._tcp", name: "Living Room TV" });
	assert.deepEqual(browseLine("23:59:59.001  Rmv        0   1 local.               _IPP._tcp.           Printer (2)  "), { add: false, iface: "1", service: "_ipp._tcp", name: "Printer (2)" });
	for (const other of ["Timestamp     A/R    Flags  if Domain               Service Type         Instance Name", " 0:40:37.907  ...STARTING...", "DATE: ---Mon 16 Nov 2026---", ""]) assert.equal(browseLine(other), undefined);
});

test("presence: silence is not leaving until it has lasted; coming back says for how long it was gone", () => {
	const t = tracker(600_000);
	const phone = { name: "phone", address: "192.168.1.23" };
	const T = Date.parse("2026-11-16T10:00:00Z");
	// The starting point, in either state, says nothing.
	assert.equal(t.sight("host:phone", true, T, true, phone), undefined);
	assert.equal(t.sight("host:tv", false, T, true, { name: "tv" }), undefined);
	// A phone that sleeps: silent for some minutes, then heard again. Nothing happened.
	assert.equal(t.sight("host:phone", false, T + 300_000, false, phone), undefined);
	assert.equal(t.sight("host:phone", true, T + 400_000, false, phone), undefined);
	// Silent for as long as `away`: gone, since it was last heard.
	assert.equal(t.sight("host:phone", false, T + 900_000, false, phone), undefined);
	assert.deepEqual(t.sight("host:phone", false, T + 1_000_000, false, phone), { event: "left", payload: { ...phone, lastSeen: new Date(T + 400_000).toISOString() } });
	assert.equal(t.sight("host:phone", false, T + 1_100_000, false, phone), undefined, "said once");
	assert.deepEqual(t.sight("host:phone", true, T + 4_000_000, false, phone), { event: "arrived", payload: { ...phone, awayFor: 3600 } });
	// One that was not there at the start, and one nobody knew of.
	assert.deepEqual(t.sight("host:tv", true, T + 5000, false, { name: "tv", address: "192.168.1.30" }), { event: "arrived", payload: { name: "tv", address: "192.168.1.30" } });
	assert.deepEqual(t.sight("service:new._airplay._tcp.local", true, T, false, { name: "New", service: "_airplay._tcp" }), { event: "arrived", payload: { name: "New", service: "_airplay._tcp" } });
	assert.equal(t.sight("service:never", false, T, false, { name: "never" }), undefined);
	// A goodbye is leaving at once.
	assert.deepEqual(t.gone("service:new._airplay._tcp.local")?.event, "left");
	assert.equal(t.gone("service:new._airplay._tcp.local"), undefined);
});

test("presence: who is there at the start is not reported; a device that came and one that went are", async () => {
	Object.assign(netTiming, { probeMs: 300, listenMs: 50 });
	const net2 = { type: "presence", hosts: { here: "127.0.0.1", nobody: "192.0.2.1" }, every: "50ms", away: "200ms" };
	const h = await harness({ pine: { sources: { lan: { ...net2, start: "always" }, known: net2 } }, agents: { main: {} } });
	await until(() => /1 of 2 there$/.test(infoOf(h, "lan").status ?? ""), 6000, "the first look");
	await sleep(150);
	assert.equal(h.pine.bus.query({ topic: "source/#" }).length, 0, "the first look is the starting point");

	// A source that knows from before: the one that was gone is here now, the one that was here has been silent for too long.
	const now = Date.now();
	const kv = (h.pine.sources as any).kv;
	kv.set("source:known:began", true);
	kv.set("source:known:state", { "host:here": { there: false, last: now - 90_000, left: now - 90_000, name: "here", address: "127.0.0.1" }, "host:nobody": { there: true, last: now - 10_000, name: "nobody", address: "192.0.2.1" } });
	await h.pine.sources.subscribe("main", "known", { note: "Say who came and went.", throttle: "10ms" });
	await until(() => eventsOf(h, "known").length === 2, 6000, "the arrival and the departure");
	const by = Object.fromEntries(eventsOf(h, "known").map((e: any) => [e.topic.split("/").pop(), e.payload]));
	assert.deepEqual([by.arrived.name, by.arrived.address, by.left.name, by.left.address], ["here", "127.0.0.1", "nobody", "192.0.2.1"]);
	assert.ok(by.arrived.awayFor >= 89 && by.arrived.awayFor <= 100, String(by.arrived.awayFor));
	assert.ok(Math.abs(Date.parse(by.left.lastSeen) - (now - 10_000)) < 5, by.left.lastSeen);
	await sleep(200);
	assert.equal(eventsOf(h, "known").length, 2, "each is said once");
	await h.close();
});
