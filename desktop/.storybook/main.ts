import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
	framework: "@storybook/react-vite",
	stories: ["../src/**/*.stories.tsx"],
	addons: ["@storybook/addon-docs"],
	core: { disableTelemetry: true },
	// Storybook leaves out vite.config.ts's `build`: CSS is minified by esbuild here too, for the reason given there.
	// The stories draw pine's own themes (themes.ts), which lie in the repository above the app's folder.
	viteFinal: (config) => ({ ...config, build: { ...config.build, cssMinify: "esbuild" }, server: { ...config.server, fs: { ...config.server?.fs, allow: [...(config.server?.fs?.allow ?? []), "..", "../../examples/home/themes", "../../src"] } } }),
};

export default config;
