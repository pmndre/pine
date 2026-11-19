// Telling a test's own daemon from another run's. Tests of several runs (several checkouts on one
// Mac) start daemons side by side, and a port a test picked can be taken by another run's daemon
// before its own binds it. `/health` answers without the token, so any daemon passes it: these ask
// `/overview` with the token of the test's home, which only that home's daemon takes.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

/** A port nothing listens on now. */
export const freePort = () =>
	new Promise<number>((resolve) => {
		const s = net.createServer().listen(0, "127.0.0.1", () => {
			const { port } = s.address() as net.AddressInfo;
			s.close(() => resolve(port));
		});
	});

const tokenOf = (home: string) => {
	try {
		return fs.readFileSync(path.join(home, "data", "http-token"), "utf8").trim();
	} catch {
		return undefined;
	}
};

/**
 * Who answers at this port: "ours" (the daemon of `home`), "other" (something that refuses the
 * token of `home`, a daemon of another home, or an answer that is not pine's), "slow" (a
 * connection was made but no answer came in time: a daemon under load can take seconds for
 * /overview, and is not gone), or "none" (the connection was refused, or `home` has no token yet).
 */
export async function whoAnswers(port: number | string, home: string): Promise<"ours" | "other" | "slow" | "none"> {
	const token = tokenOf(home);
	if (!token) return "none";
	const timedOut = (e: unknown) => e instanceof Error && e.name === "TimeoutError";
	let res: Response;
	try {
		res = await fetch(`http://127.0.0.1:${port}/overview`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
	} catch (e) {
		return timedOut(e) ? "slow" : "none";
	}
	if (!res.ok) {
		await res.body?.cancel();
		return "other";
	}
	let body: { home?: string };
	try {
		body = (await res.json()) as { home?: string };
	} catch (e) {
		return timedOut(e) ? "slow" : "other";
	}
	return path.resolve(String(body?.home)) === path.resolve(home) ? "ours" : "other";
}

/** The daemon of `home` answers at this port: true when it does. A slow answer is not one. */
export const ours = async (port: number | string, home: string) => (await whoAnswers(port, home)) === "ours";

/** Wait until the daemon of `home` answers at this port; fail at once when another one does. */
export async function waitForDaemon(port: number | string, home: string, timeoutMs = 15_000): Promise<void> {
	const until = Date.now() + timeoutMs;
	for (;;) {
		const who = await whoAnswers(port, home);
		if (who === "ours") return;
		if (who === "other") throw new Error(`port ${port} is answered by a daemon that does not take the token of ${home}: another run's. Pick another port.`);
		if (Date.now() > until) throw new Error(`the daemon of ${home} did not come up on port ${port} within ${timeoutMs / 1000} s`);
		await new Promise((r) => setTimeout(r, 100));
	}
}

/**
 * Wait until the daemon of `home` no longer answers at this port: true when it is gone. Another
 * run's daemon there does not count; one that is too slow to answer is still there. Needs the
 * home's token: once the home is removed, every daemon counts as gone.
 */
export async function daemonGone(port: number | string, home: string, timeoutMs = 15_000): Promise<boolean> {
	const until = Date.now() + timeoutMs;
	for (;;) {
		const who = await whoAnswers(port, home);
		if (who !== "ours" && who !== "slow") return true;
		if (Date.now() > until) return false;
		await new Promise((r) => setTimeout(r, 150));
	}
}

/**
 * End the daemon `pine service --keep` left running on `home`, found by the home it was started
 * for, and wait until it is gone; fail when it is still there. Call it before the home is
 * removed: without its token the daemon cannot be told apart and counts as gone.
 */
export async function stopKept(port: number | string, home: string, timeoutMs = 15_000): Promise<void> {
	try {
		execFileSync("/usr/bin/pkill", ["-TERM", "-f", `service --home ${home}`]);
	} catch {
		// nothing left to stop
	}
	if (!(await daemonGone(port, home, timeoutMs))) throw new Error(`the daemon of ${home} still answers on port ${port} ${timeoutMs / 1000} s after it was told to stop`);
}
