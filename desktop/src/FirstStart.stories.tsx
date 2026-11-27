import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import type { ServiceState } from "./bridge.ts";
import { Gate } from "./App.tsx";
import { store } from "./model.ts";
import { addPrinted } from "./text.ts";

// The first start on this computer (`Gate` in App.tsx): there is no pine home, and the app runs
// `pine init` without a question (`setUp` in model.ts). The owner is shown what it says, and is
// asked nothing unless it did not finish.

const noHome: ServiceState = { status: "error", kind: "no-home", message: "There is no pine home here yet: run pine init first." };

function FirstStart({ running, lines }: { running: boolean; lines: string[] }) {
	store.stateRead = true;
	store.local = true;
	store.service = noHome;
	store.initRunning = running;
	// As the page keeps what pine init prints: a download's progress is one line that counts up.
	const kept: string[] = [];
	for (const line of lines) addPrinted(kept, line);
	store.initLines = kept;
	return (
		<div className="flex h-dvh w-full">
			<Gate />
		</div>
	);
}

const meta = {
	component: FirstStart,
	parameters: { layout: "fullscreen" },
	// What a story sets on the store is put back after it: the next story starts from the store as it was.
	beforeEach: () => {
		const { stateRead, local, service, initRunning, initLines } = store;
		return () => void Object.assign(store, { stateRead, local, service, initRunning, initLines });
	},
} satisfies Meta<typeof FirstStart>;
export default meta;
type Story = StoryObj<typeof meta>;

// What pine init prints, in its own words (src/cli.ts) and Playwright's, whose installer fetches the browser:
// without a terminal it prints a line for every tenth of a download.
const created = ["Created in /Users/you/.pine:", "  AGENTS.md", "  TOOLS.md", "  USER.md", "  models.json", "  pine.json", "  themes/pmndre.json", "  views/office.ts", "  agents/main/agent.json", "  agents/main/workspace/AGENTS.md", "", "Getting the browser the built-in web tools drive (about 600 MB, once) ..."];
const bar = (tenths: number, size: string) => `|${"■".repeat(tenths * 8)}${" ".repeat((10 - tenths) * 8)}| ${String(tenths * 10).padStart(3)}% of ${size}`;
const bars = (upTo: number, size: string) => Array.from({ length: upTo + 1 }, (_, i) => bar(i, size));
const chromium = "Downloading Chromium 141.0.7390.37 (playwright build v1194) from https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/1194/chromium-mac-arm64.zip";
const chromiumDone = [chromium, ...bars(10, "129.7 MiB"), "Chromium 141.0.7390.37 (playwright build v1194) downloaded to /Users/you/Library/Caches/ms-playwright/chromium-1194"];

/** pine init at work: the example home was copied and the browser is asked for. Nothing to press. */
export const SettingUp: Story = {
	args: { running: true, lines: created },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("Setting up pine")).toBeInTheDocument();
		await expect(canvas.queryAllByRole("button")).toHaveLength(0);
	},
};

/** Chromium on its way: Playwright's installer prints a line for every tenth, and the page keeps the last. */
export const DownloadingChromium: Story = {
	args: { running: true, lines: [...created, chromium, ...bars(4, "129.7 MiB")] },
	play: SettingUp.play,
};

/** What comes with the browser (FFmpeg, the headless shell), each download one line; the block scrolls and follows its end. */
export const DownloadingTheRest: Story = {
	args: {
		running: true,
		lines: [
			...created,
			...chromiumDone,
			"Downloading FFMPEG playwright build v1011 from https://cdn.playwright.dev/dbazure/download/playwright/builds/ffmpeg/1011/ffmpeg-mac-arm64.zip",
			...bars(10, "1 MiB"),
			"FFMPEG playwright build v1011 downloaded to /Users/you/Library/Caches/ms-playwright/ffmpeg-1011",
			"Downloading Chromium Headless Shell 141.0.7390.37 (playwright build v1194) from https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/1194/chromium-headless-shell-mac-arm64.zip",
			...bars(7, "81.7 MiB"),
		],
	},
	play: SettingUp.play,
};

/** pine init could not make the home: what it said stays, with Try again, which runs it again. (When only the browser did not come, the home is there and the app goes on.) */
export const Failed: Story = {
	args: { running: false, lines: ["Error: EACCES: permission denied, mkdir '/Users/you/.pine'"] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("pine is not ready yet")).toBeInTheDocument();
		await expect(canvas.getByRole("button", { name: "Try again" })).toBeInTheDocument();
	},
};

/** On Linux the sandbox needs an administrator: the home is made, the commands stay in view for a terminal, then Try again goes on to the app. */
export const NeedsAdministrator: Story = {
	args: {
		running: false,
		lines: ["Created in /home/you/.pine:", "  pine.json", "  agents/main/agent.json", "", "The sandbox needs bubblewrap, which is not installed.", "Nobody is here to say yes. Run this in a terminal:", "  sudo apt-get install -y bubblewrap"],
	},
	play: Failed.play,
};
