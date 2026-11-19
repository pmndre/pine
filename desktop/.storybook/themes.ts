// pine's own themes, resolved as pine resolves them (src/theme-colors.ts), for the stories: the page
// in the app is handed these colours by the daemon, which Storybook has none of.
import { resolveTheme } from "../../src/theme-colors.ts";
import type { Look } from "../src/theme.ts";

const files = import.meta.glob("../../examples/home/themes/*.json", { eager: true, import: "default" });

export const THEMES: Look[] = Object.entries(files).map(([file, raw]) => {
	const id = file.replace(/^.*\//, "").replace(/\.json$/, "");
	return { id, ...resolveTheme(JSON.parse(JSON.stringify(raw)), id) };
});
