#!/usr/bin/env node
// pine's launcher. From a checkout it runs the TypeScript sources as they are; from an installed
// package it runs the compiled ones (Node does not run TypeScript from inside node_modules).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (Number(process.versions.node.split(".")[0]) < 24) {
	console.error(`pine needs Node 24 or newer (this is ${process.versions.node}): https://nodejs.org`);
	process.exit(1);
}
// The real place of this file, also when it was started through the link npm puts on the PATH.
const root = path.resolve(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url))), "..");
const source = path.join(root, "src", "cli.ts");
if (fs.existsSync(source)) {
	// A fresh checkout: fetch what pine is built on, once, so that the first command just works.
	if (!fs.existsSync(path.join(root, "node_modules", "@earendil-works", "pi-coding-agent"))) {
		console.error("pine: installing its dependencies (once) ...");
		// pine only: the apps of the workspace (desktop/, mobile/, web/) are installed by `pnpm install` when they are wanted.
		const install = ["install", "--frozen-lockfile", "--filter", "@pmndre/pine"];
		const done = spawnSync("pnpm", install, { cwd: root, stdio: ["ignore", 2, 2] });
		if (done.status !== 0) {
			console.error(`pine: pnpm ${install.join(" ")} failed; run it in ${root} to see why${done.error ? " (pnpm is needed for a checkout: https://pnpm.io/installation)" : ""}`);
			process.exit(1);
		}
	}
	await import(pathToFileURL(source).href);
} else await import(pathToFileURL(path.join(root, "src", "cli.js")).href);
