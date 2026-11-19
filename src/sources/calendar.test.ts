import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { parseCalendar } from "./calendar.ts";
import { harness, sleep, until } from "../../testing/harness.ts";

/** A web server whose answers the test decides, request by request. Every request is noted. */
async function site(answer: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void) {
	const seen: Array<{ url: string; method: string; host: string; headers: http.IncomingHttpHeaders; body: string }> = [];
	const server = http.createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (d) => chunks.push(d));
		req.on("end", () => {
			const body = Buffer.concat(chunks).toString("utf8");
			seen.push({ url: req.url ?? "", method: req.method ?? "", host: String(req.headers.host), headers: req.headers, body });
			answer(req, body, res);
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const port = (server.address() as any).port;
	return { seen, port, base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))) };
}

/** Answers with `body` under an ETag made from it, and with 304 to whoever names that ETag. */
const tagged = (req: http.IncomingMessage, res: http.ServerResponse, type: string, body: string) => {
	const etag = `"${Buffer.from(body).length}-${[...body].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)}"`;
	if (req.headers["if-none-match"] === etag) return void res.writeHead(304, { etag }).end();
	res.writeHead(200, { "content-type": type, etag }).end(body);
};

const events = (h: any, name: string): any[] => h.pine.bus.query({ topic: `source/${name}/#` }).sort((a: any, b: any) => a.id - b.id);

const info = (h: any, name: string) => h.pine.sources.list().find((s: any) => s.name === name)!;

const looked = (h: any, ...names: string[]) => until(() => names.every((n) => /^last looked \d\d:\d\d:\d\d/.test(info(h, n).status ?? "")), 5000, `the first look of ${names.join(", ")}`);

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, "");

const day = (ms: number) => {
	const d = new Date(ms);
	return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
};

const vevent = (uid: string, summary: string, start: string, more = "") => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${summary}\r\nDTSTART${start.includes(":") ? start : `:${start}`}\r\n${more}END:VEVENT\r\n`;

const ics = (events: string, name = "Family") => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nX-WR-CALNAME:${name}\r\n${events}END:VCALENDAR\r\n`;

test("calendar: what a calendar file says, read without a library", () => {
	const { name, items } = parseCalendar(
		ics(
			[
				// A long line continued on the next one, text with escapes, a reminder inside that has a description of its own.
				`BEGIN:VEVENT\r\nUID:a@x\r\nSUMMARY:Dentist\\, Dr. Who\r\nDTSTART;TZID=Europe/Berlin:20300115T093000\r\nDTEND;TZID=Europe/Berlin:20300115T1015\r\n 00\r\nLOCATION:Main St 1\; 2nd floor\r\nDESCRIPTION:Bring the card.\\nAnd the\r\n  x-ray.\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VEVENT\r\n`,
				vevent("b@x", "Launch", "20300201T120000Z", "DURATION:PT1H30M\r\n"),
				vevent("c@x", "Holiday", ";VALUE=DATE:20300301", "DTEND;VALUE=DATE:20300304\r\n"),
				vevent("d@x", "One day", ";VALUE=DATE:20300310", "DTEND;VALUE=DATE:20300311\r\n"),
				vevent("e@x", "Standup", ';TZID="America/New_York":20250106T090000', "RRULE:FREQ=WEEKLY;BYDAY=MO\r\n"),
				vevent("e@x", "Standup (moved)", ";TZID=America/New_York:20300107T110000", "RECURRENCE-ID;TZID=America/New_York:20300107T090000\r\n"),
				vevent("f@x", "Course", "20200101T100000Z", "RRULE:FREQ=DAILY;UNTIL=20200110T000000Z\r\n"),
				vevent("g@x", "Called off", "20300401T100000Z", "STATUS:CANCELLED\r\n"),
				vevent("h@x", "Floating", "20300501T080000"),
				vevent("i@x", "Outlook", ";TZID=W. Europe Standard Time:20300601T080000"),
				"BEGIN:VEVENT\r\nSUMMARY:No uid\r\nDTSTART:20300701T080000Z\r\nEND:VEVENT\r\n",
				"BEGIN:VTODO\r\nUID:t@x\r\nSUMMARY:not an entry\r\nEND:VTODO\r\n",
			].join(""),
			"Family \\& friends",
		).replace(/\r\n/g, (_m, at: number) => (at % 2 ? "\r\n" : "\n")),
	);
	assert.equal(name, "Family \\& friends");
	const by = Object.fromEntries(items.map((i) => [i.key, i]));
	assert.deepEqual(items.map((i) => i.summary), ["Dentist, Dr. Who", "Launch", "Holiday", "One day", "Standup", "Standup (moved)", "Course", "Floating", "Outlook", "No uid"]);
	const { at, until: over, ...dentist } = by["a@x"];
	assert.deepEqual(dentist, { key: "a@x", uid: "a@x", summary: "Dentist, Dr. Who", start: "2030-01-15T09:30:00", end: "2030-01-15T10:15:00", zone: "Europe/Berlin", location: "Main St 1; 2nd floor", description: "Bring the card.\nAnd the x-ray." });
	// Berlin is an hour ahead of UTC in January.
	assert.deepEqual([new Date(at).toISOString(), new Date(over).toISOString()], ["2030-01-15T08:30:00.000Z", "2030-01-15T09:15:00.000Z"]);
	assert.deepEqual([by["b@x"].start, by["b@x"].end, by["b@x"].zone, by["b@x"].until - by["b@x"].at], ["2030-02-01T12:00:00Z", undefined, undefined, 5_400_000]);
	assert.deepEqual([by["c@x"].start, by["c@x"].end, by["c@x"].allDay], ["2030-03-01", "2030-03-03", true], "the last day, not the day after it");
	assert.deepEqual([by["d@x"].start, by["d@x"].end, by["d@x"].allDay], ["2030-03-10", undefined, true]);
	assert.deepEqual([by["e@x"].repeats, by["e@x"].zone, by["e@x"].until > Date.UTC(2100, 0)], ["FREQ=WEEKLY;BYDAY=MO", "America/New_York", true], "a repeating entry is one entry that is never over");
	assert.deepEqual([by["e@x\n20300107T090000"].summary, new Date(by["e@x\n20300107T090000"].at).toISOString()], ["Standup (moved)", "2030-01-07T16:00:00.000Z"]);
	assert.ok(by["f@x"].until < Date.UTC(2020, 0, 12), "unless its rule says until when");
	assert.equal(by["h@x"].at, new Date(2030, 4, 1, 8).getTime(), "a time without a zone is this computer's own");
	assert.deepEqual([by["i@x"].zone, by["i@x"].at], ["W. Europe Standard Time", new Date(2030, 5, 1, 8).getTime()]);
	assert.match(items.at(-1)!.uid, /^#[0-9a-f]{16}$/);
	assert.throws(() => parseCalendar("<!DOCTYPE html><html></html>"), /that address is a web page, not a calendar/);
	assert.throws(() => parseCalendar("hello"), /is not a calendar \(iCalendar, \.ics\)/);
});

test("calendar: reports what is added, changed and removed, not what is far away and not what has passed", async (t) => {
	const now = Date.now();
	const H = 3_600_000;
	// Over within a second or so: in the calendar at the first look, passed soon after.
	const brief = Math.floor(now / 1000) * 1000 + (1000 - (now % 1000) > 500 ? 1000 : 2000);
	const state: { entries: Record<string, string>; html: boolean } = {
		entries: {
			past: vevent("past@x", "Long ago", stamp(now - 48 * H), `DTEND:${stamp(now - 47 * H)}\r\n`),
			dentist: vevent("dentist@x", "Dentist", stamp(now + 24 * H), `DTEND:${stamp(now + 25 * H)}\r\nLOCATION:Main St 1\r\n`),
			trip: vevent("trip@x", "Trip", `;VALUE=DATE:${day(now + 5 * 24 * H)}`, `DTEND;VALUE=DATE:${day(now + 8 * 24 * H)}\r\n`),
			far: vevent("far@x", "Next year", stamp(now + 300 * 24 * H)),
			weekly: vevent("weekly@x", "Standup", stamp(now - 400 * 24 * H), "RRULE:FREQ=WEEKLY\r\n"),
			brief: vevent("brief@x", "Just now", stamp(now - H), `DTEND:${stamp(brief)}\r\n`),
		},
		html: false,
	};
	const web = await site((req, _body, res) => {
		if (req.url === "/family.ics") return tagged(req, res, "text/calendar; charset=utf-8", ics(Object.values(state.entries).join("")));
		if (req.url === "/page") return void res.writeHead(200, { "content-type": "text/html" }).end("<html><body>Subscribe to our calendar</body></html>");
		res.writeHead(404).end("no");
	});
	t.after(() => web.close());
	const fast = { type: "calendar", every: "40ms", start: "always" };
	const h = await harness({
		pine: { sources: { family: { ...fast, url: `${web.base}/family.ics`, ahead: "30d", token: "calendar-token-s3cret", description: "the family calendar" }, page: { ...fast, url: `${web.base}/page` } } },
		agents: { main: {} },
	});
	await looked(h, "family");
	await sleep(120);
	assert.equal(h.pine.bus.query({ topic: "source/#" }).length, 0, "what is in a calendar when it is set up is the starting point");
	assert.match(info(h, "family").status!, /now: 4 entries ahead$/, "the dentist, the trip, the standup and the one that is about to end; not next year's");
	assert.equal(web.seen[0].headers.authorization, "Bearer calendar-token-s3cret");
	await until(() => web.seen.filter((r) => r.headers["if-none-match"]).length >= 2, 4000, "looks that ask whether anything is new");

	// Added: one inside the window is reported, one beyond it is not, also not when it is changed there.
	state.entries.dinner = vevent("dinner@x", "Dinner with Ann", stamp(now + 3 * 24 * H), `DTEND:${stamp(now + 3 * 24 * H + 2 * H)}\r\nDESCRIPTION:Table for two\\, 8 pm\r\n`);
	state.entries.later = vevent("later@x", "Conference", stamp(now + 200 * 24 * H));
	state.entries.far = vevent("far@x", "Next year, moved", stamp(now + 310 * 24 * H));
	await until(() => events(h, "family").length === 1, 4000, "the new entry");
	await sleep(120);
	const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
	assert.deepEqual(events(h, "family").map((e: any) => [e.topic, e.trust, e.payload]), [["source/family/added", "untrusted", { calendar: "Family", uid: "dinner@x", summary: "Dinner with Ann", start: iso(now + 3 * 24 * H), end: iso(now + 3 * 24 * H + 2 * H), description: "Table for two, 8 pm" }]]);

	// Changed: what it was is said too. A description alone is not a change worth a turn.
	state.entries.dentist = vevent("dentist@x", "Dentist", stamp(now + 26 * H), `DTEND:${stamp(now + 27 * H)}\r\nLOCATION:Side St 9\r\nDESCRIPTION:new text\r\n`);
	state.entries.dinner = state.entries.dinner.replace("Table for two", "Table for three");
	await until(() => events(h, "family").length === 2, 4000, "the moved entry");
	assert.deepEqual([events(h, "family")[1].topic, events(h, "family")[1].payload], ["source/family/changed", { calendar: "Family", uid: "dentist@x", summary: "Dentist", start: iso(now + 26 * H), end: iso(now + 27 * H), location: "Side St 9", description: "new text", was: { summary: "Dentist", start: iso(now + 24 * H), end: iso(now + 25 * H), location: "Main St 1" } }]);

	// Removed: said for what was still ahead. What has simply passed, or was never ahead, leaves without a word.
	await until(() => Date.now() > brief + 50, 3000, "the brief entry to pass");
	delete state.entries.trip;
	delete state.entries.brief;
	delete state.entries.past;
	delete state.entries.later;
	delete state.entries.weekly;
	await until(() => events(h, "family").length === 4, 4000, "the removed entries");
	await sleep(120);
	const d = new Date(now + 5 * 24 * H);
	const tripDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
	assert.deepEqual(
		events(h, "family")
			.slice(2)
			.map((e: any) => [e.topic, e.payload])
			.sort((a: any, b: any) => a[1].uid.localeCompare(b[1].uid)),
		[
			["source/family/removed", { calendar: "Family", uid: "trip@x", summary: "Trip", start: tripDay }],
			["source/family/removed", { calendar: "Family", uid: "weekly@x", summary: "Standup", start: iso(now - 400 * 24 * H) }],
		],
	);
	assert.match(info(h, "family").status!, /now: 2 entries ahead$/);

	// A calendar that was cleared and filled again: twenty events at most, and how many more there were.
	const before = events(h, "family").length;
	for (let i = 0; i < 25; i++) state.entries[`n${i}`] = vevent(`n${String(i).padStart(2, "0")}@x`, `New ${i}`, stamp(now + (10 + i) * H));
	await until(() => events(h, "family").length === before + 20, 4000, "the many new entries");
	await sleep(120);
	const many = events(h, "family").slice(before);
	assert.deepEqual([many.length, many[0].payload.summary, many[19].payload.summary, many[19].payload.more, many[18].payload.more], [20, "New 0", "New 19", 5, undefined]);

	await until(() => /failing since/.test(info(h, "page").status ?? ""), 4000, "the page that is no calendar");
	assert.match(info(h, "page").status!, /that address is a web page, not a calendar/);
	assert.ok(!JSON.stringify(h.pine.bus.query({})).includes("calendar-token-s3cret"), "a token is in no event");
	await h.close();
});
