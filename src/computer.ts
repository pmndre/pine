// What a call to the bundled "computer" server (mcp/computer.ts) is about, and who gets that
// server at all. Shared by the gate in agents.ts, which asks the owner once per app in a
// conversation, by classify() in actions.ts, and by the server itself. It is a file of its own
// so that the server, a separate process, does not load the daemon's code with it.
import path from "node:path";
import type { Level } from "./config.ts";

/** The tools that only look. Everything else the server offers acts in an app. */
export const APP_LOOK = ["apps", "app_snapshot", "app_screenshot"];

/** What a picture shows when it was asked for without an app. */
export const WHOLE_SCREEN = "the whole screen";

/**
 * Which app a call is about: the name as the model gave it, and the key the owner's yes is kept
 * under for the conversation. `apps` names none and is not asked about. A call that should name
 * an app and does not gets none either: the server refuses it.
 */
export function appTarget(tool: string, input: unknown): { key: string; name: string } | undefined {
	if (tool === "apps") return undefined;
	const given = (input as { app?: unknown } | undefined)?.app;
	const name = typeof given === "string" ? given.trim() : "";
	if (name) return { key: `app:${name.toLowerCase()}`, name };
	return tool === "app_screenshot" ? { key: "screen", name: WHOLE_SCREEN } : undefined;
}

/**
 * Whether this system has a screen app control can work on: macOS, Windows, and Linux with an X11
 * display. A Wayland session has none for it: there a program may neither read where another
 * app's windows are nor send it keys, and the X11 tools would reach only some of the apps.
 */
export function hasDesktop(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): boolean {
	if (platform === "darwin" || platform === "win32") return true;
	if (platform !== "linux") return false;
	return Boolean(env.DISPLAY) && !env.WAYLAND_DISPLAY && env.XDG_SESSION_TYPE !== "wayland";
}

/**
 * Whether a session gets app control, and what pine tells the server then. App control acts as
 * the owner in every app on their screen, so it goes to the owner's own conversations of an agent
 * that works with the owner's account anyway ("auto" and "bypass" mode), and to nothing else: `undefined` means the server is not
 * registered for the session. It exists where `hasDesktop` says so; `standIn` is a helper program named in the
 * options, which tests use in place of the real one on any system.
 */
export function computerSession(o: { owner: boolean; level: Level; dataDir: string; platform?: string; env?: NodeJS.ProcessEnv; standIn?: boolean }): { helperDir: string } | undefined {
	if (!o.owner || (o.level !== "auto" && o.level !== "bypass")) return undefined;
	if (!hasDesktop(o.platform, o.env) && !o.standIn) return undefined;
	return { helperDir: path.join(o.dataDir, "computer") };
}
