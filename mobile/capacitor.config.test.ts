// Capacitor's configuration: the page comes from the app itself and goes nowhere else.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ORIGINS } from "./src/plugin.ts";

const config = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "capacitor.config.json"), "utf8"));

test("no remote content: the page is the built one, served by the app", () => {
	assert.equal(config.server.url, undefined);
	assert.equal(config.webDir, "dist");
	assert.equal(config.android?.allowMixedContent, false);
});

test("no navigation away from the page", () => {
	assert.deepEqual(config.server.allowNavigation, []);
});

test("the page's origin is the one its media base and policy name", () => {
	assert.equal(`${config.server.androidScheme}://${config.server.hostname}`, ORIGINS.android.app);
});

test("on iOS the page's origin is Capacitor's own scheme: WKWebView keeps https for itself", () => {
	assert.equal(`${config.server.iosScheme ?? "capacitor"}://${config.server.hostname}`, ORIGINS.ios.app);
});

test("the plugin intercepts the media base the bridge gives, on the origin it keeps the page to", () => {
	const links = fs.readFileSync(path.join(import.meta.dirname, "core/src/main/kotlin/pine/mobile/core/Links.kt"), "utf8");
	const constant = (name: string) => links.match(new RegExp(`const val ${name} = "([^"]*)"`))?.[1];
	assert.equal(constant("APP_ORIGIN"), ORIGINS.android.app);
	assert.equal(`${constant("APP_ORIGIN")}${constant("MEDIA_PATH")}`, ORIGINS.android.media);
});

test("the iOS app: iOS 17 and later, and a sentence for the local network prompt", () => {
	const project = fs.readFileSync(path.join(import.meta.dirname, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
	const targets = [...project.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g)].map((m) => m[1]);
	assert.ok(targets.length > 0);
	assert.deepEqual(new Set(targets), new Set(["17.0"]));
	const plist = fs.readFileSync(path.join(import.meta.dirname, "ios/App/App/Info.plist"), "utf8");
	assert.match(plist, /<key>NSLocalNetworkUsageDescription<\/key>\s*<string>[^<]{20,}<\/string>/);
	assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = dev\.pmndre\.pine;/);
});

test("on iOS the web view takes the whole screen (the page keeps itself inside the safe area), does not scroll, and shows no link previews", () => {
	assert.equal(config.ios?.contentInset, "never");
	assert.equal(config.ios?.scrollEnabled, false);
	assert.equal(config.ios?.allowsLinkPreview, false);
});
