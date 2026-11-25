// Unit tests for shared per-window layout sanitization, IPC validation, and cascading geometry.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	CASCADE_STEP,
	cascadeBounds,
	chromeOf,
	cleanBounds,
	cleanChromeLayout,
	cleanNewWindowOptions,
	cleanTabDrag,
	cleanTabDragEnd,
	cleanTabs,
	cleanWidths,
	cleanWindowLayout,
	cleanWindows,
	insideRect,
	MAX_WINDOWS,
	TEAR_OFF_GRIP,
	tearOffBounds,
} from "../electron/window-layout.ts";

test("cleanBounds validates dimensions, rounds numbers, and keeps valid optional coordinates", () => {
	assert.equal(cleanBounds(null), undefined);
	assert.equal(cleanBounds("nope"), undefined);
	assert.equal(cleanBounds({ width: 300, height: 400 }), undefined);
	assert.equal(cleanBounds({ width: 400, height: 200 }), undefined);
	assert.equal(cleanBounds({ width: Number.NaN, height: 500 }), undefined);
	assert.deepEqual(cleanBounds({ width: 1280.4, height: 820.6 }), { width: 1280, height: 821 });
	assert.deepEqual(cleanBounds({ x: -120.4, y: 40.6, width: 800, height: 600 }), { x: -120, y: 41, width: 800, height: 600 });
	assert.deepEqual(cleanBounds({ x: "bad", y: Number.POSITIVE_INFINITY, width: 500, height: 400 }), { width: 500, height: 400 });
});

test("cleanWidths keeps finite widths within [120, 2000] and rounds them", () => {
	assert.deepEqual(cleanWidths(undefined), {});
	assert.deepEqual(cleanWidths("invalid"), {});
	assert.deepEqual(
		cleanWidths({ sidebar: 240.4, code: 119, aside: 2001, view: 600.7, extra: 400 }),
		{ sidebar: 240, view: 601 },
	);
	assert.deepEqual(cleanWidths({ sidebar: 120, code: 2000 }), { sidebar: 120, code: 2000 });
});

test("cleanTabs drops invalid entries, deduplicates by agent:session, and caps at 50", () => {
	assert.deepEqual(cleanTabs(null), []);
	assert.deepEqual(
		cleanTabs([
			null,
			{ agent: "", session: "main" },
			{ agent: "main", session: "" },
			{ agent: "main", session: "main" },
			{ agent: "main", session: "main" },
			{ agent: "scout", session: "s1" },
		]),
		[
			{ agent: "main", session: "main" },
			{ agent: "scout", session: "s1" },
		],
	);
	const many = Array.from({ length: 60 }, (_, i) => ({ agent: "a", session: `s${i}` }));
	assert.equal(cleanTabs(many).length, 50);
});

test("cleanWindowLayout sanitizes defaults, active clamping, order, and folded keys", () => {
	assert.equal(cleanWindowLayout(null), undefined);
	assert.deepEqual(cleanWindowLayout({}), {
		tabs: [],
		active: 0,
		sidebar: true,
		code: false,
		aside: false,
		view: false,
		widths: {},
		folded: [],
	});
	assert.deepEqual(
		cleanWindowLayout({
			host: "box",
			tabs: [
				{ agent: "main", session: "main" },
				{ agent: "scout", session: "main" },
			],
			active: 99,
			noTab: true,
			sidebar: false,
			code: true,
			aside: true,
			view: false,
			order: ["view", "invalid", "code", "view"],
			widths: { sidebar: 260, code: 10 },
			folded: ["g1", "", "g1", "x".repeat(201), "g2"],
		}),
		{
			host: "box",
			tabs: [
				{ agent: "main", session: "main" },
				{ agent: "scout", session: "main" },
			],
			active: 1,
			noTab: true,
			sidebar: false,
			code: true,
			aside: true,
			view: false,
			order: ["view", "code"],
			widths: { sidebar: 260 },
			folded: ["g1", "g2"],
		},
	);
	assert.equal(cleanWindowLayout({ tabs: [{ agent: "a", session: "b" }], active: -3 })?.active, 0);
	assert.equal(cleanWindowLayout({ tabs: [{ agent: "a", session: "b" }], active: 1.5 })?.active, 0);
});

test("cleanChromeLayout and chromeOf preserve only chrome properties", () => {
	assert.equal(cleanChromeLayout(undefined), undefined);
	const chrome = cleanChromeLayout({
		sidebar: false,
		aside: true,
		view: true,
		order: ["aside", "bogus"],
		widths: { sidebar: 300, code: 400 },
		folded: ["alpha", "alpha"],
	});
	assert.deepEqual(chrome, {
		sidebar: false,
		aside: true,
		view: true,
		order: ["aside"],
		widths: { sidebar: 300, code: 400 },
		folded: ["alpha"],
	});

	const full = cleanWindowLayout({
		host: "remote",
		tabs: [{ agent: "main", session: "main" }],
		active: 0,
		sidebar: true,
		code: true,
		aside: false,
		view: true,
		order: ["code", "view"],
		widths: { sidebar: 220 },
		folded: ["f1"],
	})!;
	const extracted = chromeOf(full);
	assert.deepEqual(extracted, {
		sidebar: true,
		aside: false,
		view: true,
		order: ["code", "view"],
		widths: { sidebar: 220 },
		folded: ["f1"],
	});
	extracted.folded.push("mutated");
	assert.deepEqual(full.folded, ["f1"]);
});

test("cleanWindows falls back unknown hosts to local and enforces the 20-window cap", () => {
	assert.deepEqual(cleanWindows("not-an-array", []), []);
	const cleaned = cleanWindows(
		[
			null,
			{
				host: "known-box",
				bounds: { x: 10, y: 20, width: 1000, height: 700 },
				layout: {
					host: "known-box",
					tabs: [{ agent: "main", session: "main" }],
					active: 0,
					sidebar: false,
					code: true,
					aside: false,
					view: false,
					widths: { sidebar: 250 },
					folded: ["g1"],
				},
			},
			{
				host: "removed-box",
				bounds: { x: 50, y: 60, width: 900, height: 600 },
				layout: {
					host: "removed-box",
					tabs: [{ agent: "remote", session: "s1" }],
					active: 0,
					noTab: true,
					sidebar: false,
					code: false,
					aside: true,
					view: false,
					widths: { aside: 420 },
					folded: ["g2"],
				},
			},
		],
		["known-box"],
	);
	assert.equal(cleaned.length, 2);
	assert.equal(cleaned[0].host, "known-box");
	assert.deepEqual(cleaned[0].layout?.tabs, [{ agent: "main", session: "main" }]);

	assert.equal(cleaned[1].host, undefined);
	assert.equal(cleaned[1].layout?.host, undefined);
	assert.deepEqual(cleaned[1].layout?.tabs, []);
	assert.equal(cleaned[1].layout?.active, 0);
	assert.equal(cleaned[1].layout?.noTab, false);
	assert.equal(cleaned[1].layout?.sidebar, false);
	assert.equal(cleaned[1].layout?.aside, true);
	assert.deepEqual(cleaned[1].layout?.widths, { aside: 420 });

	const many = Array.from({ length: MAX_WINDOWS + 5 }, (_, i) => ({
		bounds: { x: i * 10, y: i * 10, width: 800, height: 600 },
	}));
	assert.equal(cleanWindows(many, []).length, MAX_WINDOWS);
});

test("cleanNewWindowOptions validates host, tab, moveFrom, and bounded draft", () => {
	assert.equal(cleanNewWindowOptions(undefined), undefined);
	assert.equal(cleanNewWindowOptions(null), undefined);
	assert.equal(cleanNewWindowOptions([]), undefined);
	assert.equal(cleanNewWindowOptions({}), undefined);

	assert.deepEqual(cleanNewWindowOptions({ host: null }), { host: null });
	assert.deepEqual(cleanNewWindowOptions({ host: "box" }), { host: "box" });
	assert.equal(cleanNewWindowOptions({ host: "" }), undefined);
	assert.equal(cleanNewWindowOptions({ host: 123 }), undefined);

	assert.deepEqual(
		cleanNewWindowOptions({
			host: "box",
			tab: { agent: "main", session: "s1" },
			moveFrom: true,
		}),
		{
			host: "box",
			tab: { agent: "main", session: "s1" },
			moveFrom: true,
		},
	);
	assert.equal(cleanNewWindowOptions({ tab: { agent: "", session: "s1" } }), undefined);
	assert.equal(cleanNewWindowOptions({ tab: { agent: "main", session: "" } }), undefined);

	const attachments = Array.from({ length: 60 }, (_, i) => ({
		name: `f${i}.txt`,
		size: i + 1,
		data: "abc",
		...(i === 0 ? { preview: "data:image/png;base64,AA" } : {}),
	}));
	const quotes = [
		{ id: 1, tab: "main:main", text: "from welcome", source: "welcome" },
		{ id: 2, tab: "main:main", text: "from letter", source: "letter" },
		{ id: 3, tab: "main:main", text: "from task", source: { task: 4, part: "answer" } },
		{ id: 4, tab: "main:main", text: "bad source", source: { task: 0, part: "answer" } },
		...Array.from({ length: 25 }, (_, i) => ({
			id: i + 10,
			tab: "main:main",
			text: `q${i}`,
			source: { task: i + 1, part: "prompt" as const },
		})),
	];
	const res = cleanNewWindowOptions({
		draft: {
			draft: "hello",
			attachments: [{ name: "bad", size: -1, data: "x" }, ...attachments],
			quotes,
		},
	});
	assert.ok(res?.draft);
	assert.equal(res.draft.draft, "hello");
	assert.equal(res.draft.attachments.length, 50);
	assert.equal(res.draft.attachments[0].preview, "data:image/png;base64,AA");
	assert.equal(res.draft.quotes?.length, 20);
	assert.deepEqual(res.draft.quotes?.[0], { id: 1, tab: "main:main", text: "from welcome", source: "welcome" });
	assert.deepEqual(res.draft.quotes?.[2], { id: 3, tab: "main:main", text: "from task", source: { task: 4, part: "answer" } });
	assert.ok(!res.draft.quotes?.some((q) => q.text === "bad source"));

	// Invalid draft (missing string draft field) is dropped.
	assert.equal(cleanNewWindowOptions({ draft: { draft: 42, attachments: [] } }), undefined);
});

test("cascadeBounds offsets normally, wraps at right/bottom edges, and clamps oversized anchors", () => {
	const workArea = { x: 0, y: 25, width: 1440, height: 875 };

	// Normal step (+24, +24).
	assert.deepEqual(
		cascadeBounds({ x: 100, y: 100, width: 800, height: 600 }, workArea),
		{ x: 100 + CASCADE_STEP, y: 100 + CASCADE_STEP, width: 800, height: 600 },
	);

	// Right edge wrap (x + 24 + width > workArea.x + workArea.width).
	assert.deepEqual(
		cascadeBounds({ x: 630, y: 100, width: 800, height: 600 }, workArea),
		{ x: CASCADE_STEP, y: 100 + CASCADE_STEP, width: 800, height: 600 },
	);

	// Bottom edge wrap (y + 24 + height > workArea.y + workArea.height).
	assert.deepEqual(
		cascadeBounds({ x: 100, y: 290, width: 800, height: 600 }, workArea),
		{ x: 100 + CASCADE_STEP, y: workArea.y + CASCADE_STEP, width: 800, height: 600 },
	);

	// Secondary display with non-zero origin.
	const secondDisplay = { x: 1440, y: 0, width: 1280, height: 720 };
	assert.deepEqual(
		cascadeBounds({ x: 2000, y: 200, width: 800, height: 600 }, secondDisplay),
		{ x: 1440 + CASCADE_STEP, y: CASCADE_STEP, width: 800, height: 600 },
	);

	// Anchor larger than workArea clamps size and origin to workArea.
	assert.deepEqual(
		cascadeBounds({ x: 50, y: 50, width: 2000, height: 1500 }, workArea),
		{ x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height },
	);
});

test("a dragged tab from IPC keeps one conversation and a clean draft, and nothing else", () => {
	assert.equal(cleanTabDrag(null), undefined);
	assert.equal(cleanTabDrag({ tab: { agent: "", session: "s" } }), undefined);
	assert.equal(cleanTabDrag({ tab: "main:main" }), undefined);
	assert.deepEqual(cleanTabDrag({ tab: { agent: "scout", session: "s1", extra: 1 }, other: true }), { tab: { agent: "scout", session: "s1" } });
	assert.deepEqual(cleanTabDrag({ tab: { agent: "scout", session: "s1" }, draft: { draft: "hi", attachments: [{ name: "a.txt", size: 2, data: "aGk=" }, { name: 3 }] } }), {
		tab: { agent: "scout", session: "s1" },
		draft: { draft: "hi", attachments: [{ name: "a.txt", size: 2, data: "aGk=" }] },
	});
	// A draft that is not one is dropped, the tab still goes.
	assert.deepEqual(cleanTabDrag({ tab: { agent: "scout", session: "s1" }, draft: { draft: 5 } }), { tab: { agent: "scout", session: "s1" } });
});

test("the end of a tab drag says only true for true, and a place only with both numbers", () => {
	assert.deepEqual(cleanTabDragEnd(undefined), { outside: false, alone: false });
	assert.deepEqual(cleanTabDragEnd({ outside: "yes", alone: 1 }), { outside: false, alone: false });
	assert.deepEqual(cleanTabDragEnd({ outside: true, alone: true, x: 10.6, y: -4 }), { outside: true, alone: true, x: 11, y: -4 });
	assert.deepEqual(cleanTabDragEnd({ outside: true, x: 10 }), { outside: true, alone: false });
	assert.deepEqual(cleanTabDragEnd({ outside: true, x: Infinity, y: 1 }), { outside: true, alone: false });
	assert.deepEqual(cleanTabDragEnd({ outside: true, x: 1e9, y: 1 }), { outside: true, alone: false });
});

test("a torn-off window keeps its size and puts the pointer on its tab row, inside the screen", () => {
	const area = { x: 0, y: 25, width: 1512, height: 944 };
	assert.deepEqual(tearOffBounds({ x: 900, y: 300 }, { width: 700, height: 500 }, area), { x: 900 - TEAR_OFF_GRIP.x, y: 300 - TEAR_OFF_GRIP.y, width: 700, height: 500 });
	// Near the right and bottom edges it is pushed back in; near the top left it stops at the edge.
	assert.deepEqual(tearOffBounds({ x: 1500, y: 960 }, { width: 700, height: 500 }, area), { x: 1512 - 700, y: 25 + 944 - 500, width: 700, height: 500 });
	assert.deepEqual(tearOffBounds({ x: 5, y: 0 }, { width: 700, height: 500 }, area), { x: 0, y: 25, width: 700, height: 500 });
	// Larger than the screen it takes the screen; on a second display it stays there.
	assert.deepEqual(tearOffBounds({ x: 200, y: 200 }, { width: 3000, height: 2000 }, area), { x: 0, y: 25, width: 1512, height: 944 });
	assert.deepEqual(tearOffBounds({ x: 2000, y: 300 }, { width: 700, height: 500 }, { x: 1512, y: 0, width: 1920, height: 1080 }), { x: 2000 - TEAR_OFF_GRIP.x, y: 300 - TEAR_OFF_GRIP.y, width: 700, height: 500 });
	assert.equal(insideRect({ x: 10, y: 10 }, { x: 0, y: 0, width: 10, height: 20 }), false);
	assert.equal(insideRect({ x: 9, y: 19 }, { x: 0, y: 0, width: 10, height: 20 }), true);
});
