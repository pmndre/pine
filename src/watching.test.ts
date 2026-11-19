import assert from "node:assert/strict";
import { test } from "node:test";
import { lineDiff, pageText, numberOf, selected, selector } from "./watching.ts";

test("watching: what a page says to a reader, and which lines of a text are new", () => {
	assert.equal(pageText("<html><head><title>T</title><script>x()</script></head><body><h1>A &amp; B</h1><p>one<br>two &#8364; &#x41;</p><style>p{}</style><div>  three   four </div></body></html>"), "A & B\none\ntwo € A\nthree four");
	assert.deepEqual(lineDiff("a\nb\nc", "a\nc\nd"), { added: ["d"], removed: ["b"] });
	assert.deepEqual(lineDiff("a\nb", "b\na"), { added: [], removed: [] });
	assert.equal(lineDiff("", Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n")).more, 20);
});

test("watching: which values read as a number, and which do not", () => {
	const is: Array<[unknown, number]> = [
		[12.5, 12.5],
		["12.5", 12.5],
		["12,5", 12.5],
		["12,50", 12.5],
		["87 %", 87],
		["87%", 87],
		["$1,299.00", 1299],
		["1.299,00 €", 1299],
		["1,234,567.89", 1234567.89],
		["1.234.567", 1234567],
		["1 299,00 kr", 1299],
		["1'299.50", 1299.5],
		["CHF 1’299.50", 1299.5],
		["-3,5 °C", -3.5],
		["−4", -4],
		["0,125", 0.125],
		["0.125", 0.125],
		["1234.567", 1234.567],
		["42", 42],
		["3 GB", 3],
		// One separator and exactly three digits after it can be read two ways. What stands next to it decides.
		["1,299", 1299],
		["1.299", 1.299],
		["$1.299", 1.299],
		["1.299 €", 1299],
		["€ 1.299", 1299],
		["1,299 €", 1.299],
		["2.500 zł", 2500],
	];
	for (const [value, n] of is) assert.equal(numberOf(value), n, JSON.stringify(value));
	for (const not of ["1.2.3", "v1.2.3", "2024-05-01", "12:30", "about 5", "5 of 10", "", "1,2,3", "1.299,00,5", "12 5", "1 2345", "in stock", null, undefined, true, { a: 1 }, Number.NaN]) assert.equal(numberOf(not), undefined, JSON.stringify(not));
});

test("watching: a selector finds one element of a page, and says what it cannot read", () => {
	const page = `<!doctype html><html><head><title>Shop &amp; more</title><meta property="og:price:amount" content="499.00"></head><body>
<div id="main"><ul class="list"><li class="item">One<li class="item sale"><span class="price">12,99 €</span> <b>now</b><li>Three</ul>
<p>first<p class="note">second<div class="box"><span class="price" data-raw="99.5">99</span></div>
<table id="stock"><tr><td>A<td class="count">3<tr><td>B<td class="count">7</table>
<script>var x = "<span class='hidden price'>0</span>";</script><br/><img src="x.png" alt="pic"><em>after</em></div></body></html>`;
	const pick = (sel: string, attr?: string) => selected(page, selector(sel), attr);
	assert.equal(pick(".price"), "12,99 €");
	assert.equal(pick("li.sale > span.price"), "12,99 €");
	assert.equal(pick("li.item"), "One", "a list item ends where the next one begins");
	assert.equal(pick("li.sale"), "12,99 € now");
	assert.equal(pick("div.box .price"), "99");
	assert.equal(pick("#main > .box > span"), "99", "a block ends the paragraph before it");
	assert.equal(pick("p.note"), "second");
	assert.equal(pick("table#stock td.count"), "3");
	assert.equal(pick("#stock tr > td"), "A");
	assert.equal(pick("title"), "Shop & more");
	assert.equal(pick('[property="og:price:amount"]', "content"), "499.00");
	assert.equal(pick("meta[property=og:price:amount]", "CONTENT"), "499.00");
	assert.equal(pick("span[data-raw]", "data-raw"), "99.5");
	assert.equal(pick("[class~=sale] b"), "now");
	assert.equal(pick("[class^=bo] span, .nothing"), "99");
	assert.equal(pick("ul > li:not-here".replace(":not-here", ""), undefined), "One");
	assert.equal(pick("p, ul > li"), "One", "of several, the first in the page");
	assert.equal(pick("img + em".replace(" + ", " ")), null, "an image holds nothing");
	assert.equal(pick("#main > em"), "after");
	assert.equal(pick(".nothing"), null);
	assert.equal(pick(".hidden"), null, "what a script holds is not part of the page");
	assert.equal(pick("span", "nope"), null);
	for (const [bad, why] of [["li:first-child", /a part with a colon/], ["a + b", /the sign \+/], ["a ~ b", /the sign ~/], ["div >", /ends with >/], ["", /is empty/], ["a,,b", /empty part between commas/], ["..x", /at "\.\.x"/]] as const) assert.throws(() => selector(bad), why, bad);
	assert.throws(() => selector("li:first-child"), /It takes a tag, #id, \.class, \[attribute\] and \[attribute=value\]/);
});
