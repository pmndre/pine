import type { Decorator, Preview } from "@storybook/react-vite";
import { useLayoutEffect } from "react";
import "../src/index.css";
import { applyLook } from "../src/theme.ts";
import { allModes, viewports } from "./modes.ts";
import { THEMES } from "./themes.ts";

// No preload script here: the bridge is a stand-in whose every call does nothing (a listener it
// is given is never called), so that a piece which listens to the app (the Composer) can be drawn.
// A story that needs answers from the daemon puts a call of its own on it (`window.pine.call = ...`,
// as Settings.stories.tsx does): what is set on it is used, everything else still does nothing.
window.pine ??= new Proxy({} as Record<PropertyKey, unknown>, { get: (own, key) => own[key] ?? (() => () => {}) }) as unknown as typeof window.pine;

// The page is drawn in one of pine's themes, as the app is (theme.ts): the toolbar picks it.
const withTheme: Decorator = (Story, context) => {
	const id = context.globals.theme ?? "pmndre";
	useLayoutEffect(() => applyLook(THEMES.find((t) => t.id === id)), [id]);
	return <Story />;
};

const preview: Preview = {
	globalTypes: {
		theme: {
			description: "One of pine's themes, as Settings > App picks it",
			toolbar: {
				title: "Theme",
				icon: "mirror",
				items: THEMES.map((t) => ({ value: t.id, title: `${t.name} (${t.kind})` })),
				dynamicTitle: true,
			},
		},
	},
	initialGlobals: { theme: "pmndre" },
	decorators: [withTheme],
	parameters: {
		layout: "centered",
		// The toolbar's Viewport menu offers the widths Chromatic takes; by default a story fills the pane.
		viewport: { options: viewports },
		// Chromatic snapshots each story in every mode; the toolbar above still flips theme and width by hand.
		chromatic: { modes: allModes },
	},
	tags: ["autodocs"],
};

export default preview;
