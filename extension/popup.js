// What the toolbar button shows: whether pine is connected, and the groups its agents work in.
const $ = (id) => document.getElementById(id);

function draw(state) {
	const on = state?.connected === true;
	$("dot").toggleAttribute("data-on", on);
	$("title").textContent = on ? "Connected to pine" : "Not connected to pine";
	const groups = $("groups");
	groups.replaceChildren();
	if (on) {
		const list = state.groups ?? [];
		$("line").textContent = list.length ? "Your agents work in these tab groups:" : "No agent works in this browser right now.";
		for (const g of list) {
			const row = document.createElement("li");
			const name = document.createElement("span");
			name.textContent = g.title;
			const count = document.createElement("span");
			count.className = "quiet";
			count.textContent = `${g.tabs} ${g.tabs === 1 ? "tab" : "tabs"}${g.working ? "" : ", idle"}`;
			row.append(name, count);
			groups.append(row);
		}
		$("hint").textContent = "Drag a tab into a group to hand it to that agent. Drag it out to take it back.";
	} else {
		const missing = /not found/i.test(state?.why ?? "");
		$("line").textContent = missing ? "pine has not been connected to this browser yet." : "pine does not answer.";
		$("hint").textContent = missing ? "In the Pine app: Settings > Browser > Connect. In a terminal: pine chrome install. Then restart this browser." : (state?.why ?? "");
	}
	$("again").hidden = on;
}

const ask = (what) => chrome.runtime.sendMessage({ ask: what }).then(draw, () => draw(undefined));
$("again").addEventListener("click", () => {
	void ask("connect");
	setTimeout(() => void ask("state"), 800);
});
void ask("state");
