// The iOS app from end to end, inside the app itself (a hosted test: it runs in the app's process,
// on the simulator), driven by mobile/scripts/smoke-ios.mjs (`npm run smoke:ios`), which starts the
// machine (SmokeMachine.kt: an SSH server on this Mac's loopback running the real `pine service`
// with the scripted model) and answers what the test asks of the Mac. Without that run's folder
// (PINE_SMOKE_DIR) every test here is skipped.
//
// It is the test of the web view's hardening in PineViewController.swift and PinePlugin.swift,
// which no other suite reaches: each is a named check, written to the run's folder and failing the
// run. The page is driven as a person would, through its own elements, by JavaScript evaluated in
// it (WebKit counts that as a user's gesture). The run's folder is on the Mac: a simulator's app
// reads and writes the Mac's files.
import Capacitor
import UIKit
import WebKit
import XCTest
@testable import App

@MainActor
final class SmokeTests: XCTestCase {
	private var dir: URL!
	private var machine: [String: String] = [:]
	private var asked = 0
	/** WebKit's objects made for the delegate, kept for the run: they are never let go of half made. */
	private static var kept: [AnyObject] = []
	private var kept: [AnyObject] {
		get { Self.kept }
		set { Self.kept = newValue }
	}

	override func setUp() async throws {
		guard let path = ProcessInfo.processInfo.environment["PINE_SMOKE_DIR"] else { throw XCTSkip("Run by npm run smoke:ios in mobile/.") }
		dir = URL(fileURLWithPath: path)
		machine = try JSONSerialization.jsonObject(with: Data(contentsOf: dir.appendingPathComponent("machine.json"))) as! [String: String]
		// The Mac numbers what it is asked across the run: a later test goes on from where an earlier one stopped.
		asked = try FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.hasPrefix("ask-") }.count
	}

	// ---- the first start, the machine, the hardening, the app's life, the status bar ----------------

	func testFromFirstStartToTheAgents() async throws {
		keyboard.watch()
		let vc = try await bridge()
		let web = try XCTUnwrap(vc.webView)
		let plugin = try XCTUnwrap(vc.plugin)
		var opened: [String] = []
		plugin.opener = { opened.append($0.absoluteString) }

		step("the first start: pairing first, and SSH behind a link, which shows the phone's key")
		try await until("the pairing view", "document.body.innerText.includes('Pair this phone with your computer') && !!document.querySelector('[data-slot=pair-link-field]')")
		try await js("document.querySelector('[data-slot=ssh-instead]').click(); return true")
		try await until("the Gate's Choose a machine", "document.body.innerText.includes('Choose a machine')")
		let key = try await until("the phone's key", "document.body.innerText.match(/ssh-ed25519 \\S+ pine-ios/)?.[0] ?? ''") as! String
		try (key + "\n").write(to: URL(fileURLWithPath: machine["keys"]!), atomically: true, encoding: .utf8)
		try key.write(to: dir.appendingPathComponent("key.txt"), atomically: true, encoding: .utf8)

		step("Share hands the key to the system's share sheet")
		try await click("Share")
		try await waitFor("the share sheet") { vc.presentedViewController is UIActivityViewController }
		check("the key goes to the share sheet", vc.presentedViewController is UIActivityViewController, true)
		vc.dismiss(animated: false)

		let host = machine["host"]!
		step("adding \(host)")
		try await js("""
			const i = document.querySelector('input[placeholder="you@server"]');
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, \(quoted(host)));
			i.dispatchEvent(new Event('input', { bubbles: true }));
			return true;
			""")
		try await click("Add")
		try await until("the machine in the list", "[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Use')")
		try await click("Use")

		step("the host key is put to the owner, with the machine's fingerprint")
		let shown = try await until("the host key's fingerprint", "document.querySelector('[data-slot=host-key-fingerprint]')?.textContent ?? ''") as! String
		check("the fingerprint shown is the machine's", shown, machine["fingerprint"]!)
		// The text's own lines, not the element's box: a word too long for its line overflows the box.
		let text = "[...document.querySelectorAll('[data-slot=empty-description], [data-slot=host-key-fingerprint]')].flatMap((e) => { const r = document.createRange(); r.selectNodeContents(e); return [...r.getClientRects()]; })"
		let lines = try await js("return JSON.stringify(\(text).map((r) => [Math.round(r.left), Math.round(r.right)]).concat([[0, innerWidth]]))") as? String ?? ""
		check("the host key's message and fingerprint fit the screen's width", try await js("return \(text).every((r) => r.left >= 0 && r.right <= innerWidth)") as? Bool, true, detail: "lines (left, right; last the page's width): \(lines)")
		try await mac("shot host-key.png")
		try await js("document.querySelector('[data-slot=trust-host-key]').click(); return true")

		step("connected: the agents of that pine")
		try await connected(seconds: 120)
		seen("first start to the agents: main and scout are in the side bar", try await agentsShown(), true)
		try await mac("shot agents.png")
		let layout = try await js("const s = document.querySelector('[data-slot=sidebar][data-mobile]')?.getBoundingClientRect(); return JSON.stringify({ inner: innerWidth, innerH: innerHeight, scroll: document.documentElement.scrollWidth, screen: screen.width, sheet: s && [s.left, s.top, s.width, s.height], vv: visualViewport && [visualViewport.offsetLeft, visualViewport.offsetTop, visualViewport.width, visualViewport.scale] })") as? String ?? ""
		check("the page fits the screen's width, not zoomed into a field", try await js("return document.documentElement.scrollWidth <= innerWidth && innerWidth === screen.width && visualViewport.scale === 1") as? Bool, true, detail: layout)
		// The sheet is put away by its own button, as the owner would.
		try await until("the side bar put away", "(() => { const open = document.querySelector('[data-slot=sidebar][data-mobile]'); open && document.querySelector('[aria-label=\"Hide the sidebar\"]')?.click(); return !open; })()")

		step("the page within the screen: below the status bar, above the home indicator and the keyboard")
		try await js("document.activeElement?.blur(); return true")
		try await waitFor("the keyboard down") { keyboard.top == nil }
		try await settle()
		try await within(vc, "without the keyboard", shot: "insets.png")
		try await js("document.querySelector('[data-slot=composer] textarea').focus(); return true")
		try await waitFor("the keyboard up") { keyboard.top != nil }
		try await settle()
		try await within(vc, "with the keyboard", shot: "insets-keyboard.png")
		try await js("document.activeElement?.blur(); return true")
		try await waitFor("the keyboard down again") { keyboard.top == nil }
		try await settle()
		try await within(vc, "after the keyboard", shot: nil)

		step("in landscape the side bar keeps clear of the sensor housing")
		try await sideways(vc)

		step("the page's hardening")
		let here = "return location.href"
		let home = try await js(here) as? String ?? "none"
		check("the page is the app's own (capacitor://localhost)", home.hasPrefix("capacitor://localhost"), true, detail: home)
		seen("Capacitor's bridge runs under the page's policy", try await js("return typeof Capacitor === 'object' && Capacitor.isNativePlatform() && Capacitor.getPlatform()"), "ios")
		seen("the policy is the page's own (script-src 'self')", try await js("return /script-src 'self'(;|$)/.test(document.querySelector('meta[http-equiv=Content-Security-Policy]')?.content ?? '')"), true)
		seen("an inline script added to the page does not run", try await js("return await new Promise((r) => { const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.head.append(s); setTimeout(() => r(window.__inline === 1), 300); })"), false)
		check("the page's UI delegate is pine's", web.uiDelegate === vc.pageUI, true)
		let ui = try XCTUnwrap(vc.pageUI)
		// The page has no way to ask for the camera or the microphone: WebKit offers getUserMedia only
		// to an app that says why it would use them (Info.plist), and Pine says it of neither.
		for (what, constraints) in [("camera", "{ video: true }"), ("microphone", "{ audio: true }")] {
			let got = try await js("const m = navigator.mediaDevices; if (!m || !m.getUserMedia) return 'no way to ask'; return await m.getUserMedia(\(constraints)).then(() => 'given', (e) => e.name)") as? String
			check("permission denial: the page cannot have the \(what)", got != nil && got != "given", true, detail: got ?? "nil")
		}
		// Were it offered, the delegate says no: asked here as WebKit would ask it (Capacitor's says yes).
		let frame = try made(WKFrameInfo.self)
		let origin = try made(WKSecurityOrigin.self)
		for (what, type) in [("camera", WKMediaCaptureType.camera), ("microphone", .microphone), ("camera and microphone", .cameraAndMicrophone)] {
			var decision: WKPermissionDecision?
			ui.webView(web, requestMediaCapturePermissionFor: origin, initiatedByFrame: frame, type: type) { decision = $0 }
			check("permission denial: the UI delegate refuses the \(what)", decision == .deny, true, detail: decision.map { $0 == .grant ? "granted" : "prompt" } ?? "no answer")
		}
		var motionDecision: WKPermissionDecision?
		ui.webView(web, requestDeviceOrientationAndMotionPermissionFor: origin, initiatedByFrame: frame) { motionDecision = $0 }
		check("permission denial: the UI delegate refuses the motion sensors", motionDecision == .deny, true, detail: motionDecision.map { $0 == .grant ? "granted" : "prompt" } ?? "no answer")
		let motion = try await js("return typeof DeviceOrientationEvent.requestPermission !== 'function' ? 'no way to ask' : await DeviceOrientationEvent.requestPermission().then((r) => r, (e) => e.name)") as? String
		check("permission denial: the page cannot have the motion sensors", motion != nil && motion != "granted", true, detail: motion ?? "nil")
		seen("no file access: a file: address cannot be fetched", try await js("return await fetch('file:///etc/hosts').then(() => 'read', () => 'refused')"), "refused")
		check("link previews are off", web.allowsLinkPreview, false)
		check("the page does not scroll (the insets checks say where it lies)", !web.scrollView.isScrollEnabled, true)

		let tone = "pine-media://daemon/agents/scout/image?path=tone.wav"
		// What the scheme answers, asked as WebKit asks it (a fetch from the page would need a CORS answer the desktop does not give either).
		let off = await vc.media.answer(URLRequest(url: URL(string: "pine-media://daemon/not/a/media/path")!), in: web)
		check("media: a path off the list is 404", off.status, 404)
		var part = URLRequest(url: URL(string: tone)!)
		part.setValue("bytes=0-99", forHTTPHeaderField: "Range")
		let got = await vc.media.answer(part, in: web)
		check("media: a sound is answered in parts (206, content-range)", "\(got.status) \(got.header("content-range") ?? "none") \(got.body.count)", "206 bytes 0-99/\(machine["toneBytes"]!) 100")
		seen("media: a sound plays", try await js("""
			const a = new Audio('\(tone)');
			return await new Promise((r) => {
				a.onerror = () => r('error ' + (a.error && a.error.code));
				a.onloadedmetadata = () => a.play().then(() => { a.pause(); r('played ' + Math.round(a.duration)); }, (e) => r('not played: ' + e.name));
				setTimeout(() => r('no answer'), 10000);
			});
			"""), "played 1")

		let windowsBefore = webViews(in: vc.view.window)
		seen("no window: window.open gives nothing", try await js("return [window.open('https://example.com/'), window.open('sms:+15555550100'), window.open('file:///etc/hosts')].every((w) => w === null)"), true)
		try await settle()
		check("no window: no second web view, the page where it is", [webViews(in: vc.view.window) == windowsBefore && windowsBefore == 1, try await js(here) as? String == home], [true, true])
		check("no window: an address of the web is handed to Safari, nothing else", opened, ["https://example.com/"])
		opened.removeAll()

		for address in ["file:///etc/hosts", "sms:+15555550100", "tel:+15555550100", "itms-apps://apps.apple.com/", "intent://x#Intent;scheme=market;end"] {
			try await js("location.href = \(quoted(address)); return true")
			try await settle()
		}
		check("navigation: other schemes lead nowhere (file:, sms:, tel:, itms-apps:, intent:)", [try await js(here) as? String ?? "", opened.joined()], [home, ""])
		check("navigation: the app stays in front", UIApplication.shared.applicationState == .active, true)
		try await js("location.href = 'https://example.com/'; return true")
		try await settle()
		check("navigation: an address of the web is handed to Safari, not loaded in the page", [try await js(here) as? String ?? "", opened.joined()], [home, "https://example.com/"])

		step("back from the background, still on the machine")
		var left = 0
		let gone = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in left += 1 }
		defer { NotificationCenter.default.removeObserver(gone) }
		try await mac("background")
		try await waitFor("the app in front again") { UIApplication.shared.applicationState == .active }
		check("the app went to the background", left > 0, true)
		try await connected(seconds: 60)
		check("still connected after going to the background and back", plugin.pines?.connected, true)

		step("the status bar takes the theme: light icons on a dark theme, dark ones on a light theme")
		try await bars(vc, theme: try await js("return (await window.pine.call('GET', '/themes')).data.theme") as! String, dark: true, shot: "bars-dark.png")
		let set = try await js("return (await window.pine.call('POST', '/settings', { key: 'ui.theme', value: 'github-light' })).ok")
		XCTAssertEqual(set as? Bool, true, "the theme could not be set")
		try await js("location.reload(); return true")
		try await connected(seconds: 60)
		try await bars(vc, theme: "github-light", dark: false, shot: "bars-light.png")
	}

	// ---- the Keychain key, after the app was started again --------------------------------------------

	func testTheKeySurvivesARelaunch() async throws {
		_ = try await bridge()
		let before = try String(contentsOf: dir.appendingPathComponent("key.txt"), encoding: .utf8)
		let now = try await until("the phone's key from the plugin", "return (await Capacitor.Plugins.Pine.publicKey()).key", body: true) as? String
		check("the Keychain key survives a relaunch of the app", now, before)
	}

	// ---- a release build: no web inspector ------------------------------------------------------------

	/**
	 * Run on a release build made with Capacitor's own switch on (CAPACITOR_DEBUG=true, as a debug
	 * build has it), so that Capacitor makes the web view inspectable and only PineViewController's
	 * `#if !DEBUG` line turns it off again: without that line this check fails.
	 */
	func testInspectorOffInARelease() async throws {
		#if DEBUG
		throw XCTSkip("A check of a release build: npm run smoke:ios builds one for it.")
		#else
		let vc = try await bridge()
		let web = try XCTUnwrap(vc.webView)
		check("inspector off in a release build", web.isInspectable, false)
		#endif
	}

	// ---- pairing with a computer, by a pasted link and by a pine: address ---------------------------

	/**
	 * Run on fresh data, the run's authority trusted, against the Pine app's real access host (its
	 * meeting service at `service`, https in front of the helper's http one), whose daemon is the
	 * run's pine: main and scout.
	 */
	func testPairing() async throws {
		let vc = try await bridge()
		let plugin = try XCTUnwrap(vc.plugin)
		var opened: [String] = []
		plugin.opener = { opened.append($0.absoluteString) }
		let service = machine["service"]!
		let serviceHost = URL(string: service)!.host! + ":" + String(URL(string: service)!.port!)
		let here = "return location.href"
		let home = try await js(here) as? String ?? "none"

		step("the first start: pairing first, with a field for a link")
		try await until("the pairing view", "document.body.innerText.includes('Pair this phone with your computer') && !!document.querySelector('[data-slot=pair-link-field] input')")
		check("pairing first: the pairing view, its field for a link, SSH behind a link", try await js("return !!document.querySelector('[data-slot=pair-how-to]') && !!document.querySelector('[data-slot=ssh-instead]') && !document.querySelector('input[placeholder=\"you@server\"]')") as? Bool, true)
		check("state: this app says it pairs", try await js("return (await Capacitor.Plugins.Pine.state()).canPair") as? Bool, true)

		step("a pasted link: confirmed in the page, then the four digits, then Allow at the computer")
		let link = try await pairLink()
		try await js("""
			const i = document.querySelector('[data-slot=pair-link-field] input');
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, \(quoted(link)));
			i.dispatchEvent(new Event('input', { bubbles: true }));
			return true;
			""")
		try await until("the field's Pair button", "(() => { const b = [...document.querySelectorAll('[data-slot=pair-link-field] button')].find((b) => b.textContent.trim() === 'Pair' && !b.disabled); b?.click(); return !!b; })()")
		try await confirmed("pasted link", serviceHost)
		try await paired("pasted link")

		step("back from the background, the computer having cut the phone's connection meanwhile")
		try await mac("background-cut")
		try await waitFor("the app in front again") { UIApplication.shared.applicationState == .active }
		try await connected(seconds: 90)
		check("pasted link: reached again after the background, its connection cut meanwhile", try await js("return (await window.pine.call('GET', '/agents')).ok") as? Bool, true)
		check("pasted link: the paired computer is the machine in use", (plugin.pines?.inUse ?? "").hasPrefix("paired:"), true, detail: plugin.pines?.inUse ?? "none")

		step("pine: addresses that are not a pairing link this phone takes: said, and nothing starts")
		try await system("pine://pair?service=https%3A%2F%2Flocalhost&id=short&code=short")
		let bad = try await until("the page says it is not a pairing link", "document.body.innerText.includes('That is not a pairing link')")
		check("pine: address: a malformed one is ignored and says so", [(bad as? NSNumber)?.boolValue ?? false, try await js("return !document.querySelector('[data-slot=pair-confirm]')") as? Bool ?? false], [true, true])
		let next = try await pairLink()
		let fresh = try XCTUnwrap(pairLink(from: next))
		let plain = "pine://pair?service=\(escaped(machine["plainService"]!))&id=\(fresh.id)&code=\(fresh.code)"
		try await system(plain)
		let http = try await until("the page says http is refused", "document.body.innerText.includes('over http')")
		check("pine: address: a service on http is refused and said plainly", [(http as? NSNumber)?.boolValue ?? false, try await js("return !document.querySelector('[data-slot=pair-confirm]')") as? Bool ?? false], [true, true])

		step("a pine: address in the page itself leads nowhere")
		let address = "pine://pair?service=\(escaped(service))&id=\(fresh.id)&code=\(fresh.code)"
		try await js("location.href = \(quoted(address)); return true")
		try await settle()
		check("navigation: a pine: address leads nowhere and starts nothing", [try await js(here) as? String ?? "", opened.joined(), try await js("return document.querySelector('[data-slot=pair-confirm]') ? 'asked' : 'not asked'") as? String ?? ""], [home, "", "not asked"])

		step("a pine: address the system opens the app with: the confirmation for that link, then pairing")
		try await system(address)
		try await confirmed("pine: address", serviceHost)
		try await paired("pine: address")
	}

	/**
	 * The system opens the app with an address of its scheme, through the same road as after Safari's
	 * "Open in the Pine app" (the scene's `openURLContexts`). Asked from the app itself: asked from
	 * outside (`simctl openurl`), SpringBoard first puts "Open in Pine?" to the owner, which a hosted
	 * test cannot answer.
	 */
	private func system(_ address: String) async throws {
		let url = try XCTUnwrap(URL(string: address))
		let handed = await UIApplication.shared.open(url)
		XCTAssert(handed, "the system did not take \(address)")
	}

	/** A new pairing link from the computer, as its QR code carries it. */
	private func pairLink() async throws -> String {
		try await mac("pair-open")
		return try String(contentsOf: dir.appendingPathComponent("pair-link.txt"), encoding: .utf8)
	}

	private func pairLink(from link: String) -> (id: String, code: String)? {
		guard let hash = link.split(separator: "#").last, hash.hasPrefix("pair=") else { return nil }
		let parts = hash.dropFirst(5).split(separator: ".")
		return parts.count == 2 ? (String(parts[0]), String(parts[1])) : nil
	}

	private func escaped(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s }

	/** The page's question before the code is used, naming the run's service (not Pine's own): answered yes. */
	private func confirmed(_ how: String, _ serviceHost: String) async throws {
		let named = try await until("the confirmation", "document.querySelector('[data-slot=pair-confirm]') && (document.querySelector('[data-slot=pair-service]')?.textContent ?? 'no service named')") as? String ?? ""
		check("\(how): the owner is asked first, the service named", named.contains(serviceHost), true, detail: named)
		try await js("document.querySelector('[data-slot=pair-confirm-yes]').click(); return true")
	}

	/** The four digits, the computer's Allow, and the paired computer's pine: its agents. */
	private func paired(_ how: String) async throws {
		let code = try await until("the four digits", "document.querySelector('[data-slot=pairing-code]')?.textContent ?? ''") as? String ?? ""
		try await mac("pair-allow")
		let asked = try JSONSerialization.jsonObject(with: Data(contentsOf: dir.appendingPathComponent("pair-asked.json"))) as? [String: Any] ?? [:]
		check("\(how): the digits shown are the computer's", code, asked["code"] as? String ?? "none")
		check("\(how): the computer is told the phone's name", asked["name"] as? String, "Pine on \(UIDevice.current.model)")
		try await connected(seconds: 120)
		seen("\(how): after Allow the paired computer answers: main and scout are in the side bar", try await agentsShown(), true)
		try await until("the side bar put away", "(() => { const open = document.querySelector('[data-slot=sidebar][data-mobile]'); open && document.querySelector('[aria-label=\"Hide the sidebar\"]')?.click(); return !open; })()")
	}

	// ---- helpers --------------------------------------------------------------------------------------

	private func step(_ text: String) { print("- \(text)") }

	/** A named check: written to the run's folder for the script to list, and a failure of this test when it does not hold. */
	private func check<T: Equatable>(_ name: String, _ got: T, _ want: T, detail: String? = nil, file: StaticString = #filePath, line: UInt = #line) {
		let ok = got == want
		let text = ok ? "ok\t\(name)\n" : "NOT OK\t\(name)\t\(detail ?? "got \(got), wanted \(want)")\n"
		let out = dir.appendingPathComponent("checks.txt")
		if let h = try? FileHandle(forWritingTo: out) {
			h.seekToEndOfFile()
			h.write(Data(text.utf8))
			try? h.close()
		} else {
			try? text.write(to: out, atomically: true, encoding: .utf8)
		}
		XCTAssert(ok, "\(name): \(detail ?? "got \(got), wanted \(want)")", file: file, line: line)
	}

	/** A named check of what the page gave back. */
	private func seen(_ name: String, _ got: Any?, _ want: Int) { check(name, (got as? NSNumber)?.intValue, want) }
	private func seen(_ name: String, _ got: Any?, _ want: String) { check(name, got as? String, want) }
	private func seen(_ name: String, _ got: Any?, _ want: Bool) { check(name, (got as? NSNumber)?.boolValue, want) }

	/** The app's bridge view controller, once its page has loaded. */
	private func bridge() async throws -> PineViewController {
		var found: PineViewController?
		try await waitFor("the app's window") {
			found = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController as? PineViewController }.first
			return found?.webView != nil && found?.plugin != nil
		}
		try await until("the page", "document.readyState === 'complete' && !!window.pine")
		return found!
	}

	private var web: WKWebView? {
		(UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController as? PineViewController }.first)?.webView
	}

	/** Runs `body` as an async function in the page and gives back what it returns. */
	@discardableResult
	private func js(_ body: String) async throws -> Any? {
		guard let web else { throw Missing(what: "the web view") }
		return try await web.callAsyncJavaScript(body, arguments: [:], in: nil, contentWorld: .page)
	}

	/** Waits until `expression` (or a function body, with `body`) is truthy in the page, and gives it back. */
	@discardableResult
	private func until(_ what: String, _ expression: String, body: Bool = false, seconds: Double = 90) async throws -> Any {
		var last: Any?
		let deadline = Date().addingTimeInterval(seconds)
		while Date() < deadline {
			last = try? await js(body ? expression : "return \(expression)")
			if let v = last, !(v is NSNull), (v as? String) != "", (v as? NSNumber)?.boolValue != false { return v }
			try await Task.sleep(for: .milliseconds(300))
		}
		let screen = (try? await js("return document.body.innerText.slice(0, 1500)")) as? String ?? ""
		throw Missing(what: "\(what). On screen: \(screen)")
	}

	private func waitFor(_ what: String, seconds: Double = 30, _ ok: () -> Bool) async throws {
		let deadline = Date().addingTimeInterval(seconds)
		while !ok() {
			if Date() > deadline { throw Missing(what: what) }
			try await Task.sleep(for: .milliseconds(200))
		}
	}

	private func click(_ text: String) async throws {
		try await until("the button \(text)", "(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === \(quoted(text)) && !b.disabled); b?.click(); return !!b; })()")
	}

	private func settle() async throws { try await Task.sleep(for: .milliseconds(1500)) }

	/** The page past the Gate, on the machine's pine. */
	private func connected(seconds: Double) async throws {
		try await until("the page past the Gate", "!/Choose a machine|Could not reach|Connecting to|Starting pine/.test(document.body.innerText) && window.pine && (await window.pine.call('GET', '/agents')).ok", body: false, seconds: seconds)
	}

	private func agentsShown() async throws -> Any {
		// On a phone the side bar is a sheet, opened by the page's own button. The page puts the sheet away when
		// another conversation comes to the front (the main one does, once connected): it is opened again until it stays.
		return try await until("main and scout in the side bar", """
			(() => {
				const t = [...document.querySelectorAll('[data-slot=agent-label]')].map((e) => e.textContent);
				if (t.some((x) => x.includes('main')) && t.some((x) => x.includes('scout'))) return true;
				if (!document.querySelector('[role=dialog]')) (document.querySelector('[aria-label="Show the sidebar"]') ?? document.querySelector('[data-sidebar=trigger]'))?.click();
				return false;
			})()
			""")
	}

	/** Where the on-screen keyboard's top lies in the window, while it is up. */
	private let keyboard = Keyboard()

	/**
	 * The page's header and composer on the screen, in the window's points: the header's top at or below
	 * the safe area's top (the status bar, the Dynamic Island), the composer's bottom at or above what
	 * covers the page's bottom (the home indicator, or the keyboard while it is up). The page's own
	 * coordinates are taken to the window through the web view and its scroll view's offset.
	 */
	private func within(_ vc: PineViewController, _ when: String, shot: String?) async throws {
		let web = try XCTUnwrap(vc.webView)
		let window = try XCTUnwrap(vc.view.window)
		let page = try await js("""
			const h = document.querySelector('header')?.getBoundingClientRect();
			const c = document.querySelector('[data-slot=composer]')?.getBoundingClientRect();
			const p = document.createElement('div');
			p.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
			document.body.append(p);
			const s = getComputedStyle(p);
			const env = [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(parseFloat);
			p.remove();
			const v = visualViewport;
			return JSON.stringify({ header: h ? h.top : null, composer: c ? c.bottom : null, innerHeight, client: document.documentElement.clientHeight, vv: [v.offsetTop, v.height], scrollY, env });
			""") as? String ?? "{}"
		let m = try JSONSerialization.jsonObject(with: Data(page.utf8)) as? [String: Any] ?? [:]
		let origin = web.convert(CGPoint.zero, to: window).y - web.scrollView.contentOffset.y
		let header = (m["header"] as? NSNumber).map { origin + CGFloat($0.doubleValue) }
		let composer = (m["composer"] as? NSNumber).map { origin + CGFloat($0.doubleValue) }
		let top = window.safeAreaInsets.top
		let bottom = keyboard.top ?? (window.bounds.height - window.safeAreaInsets.bottom)
		let detail = "header top \(header.map { "\($0)" } ?? "none") vs safe top \(top); composer bottom \(composer.map { "\($0)" } ?? "none") vs visible bottom \(bottom) (window \(window.bounds.height), keyboard \(keyboard.top.map { "\($0)" } ?? "none")); web view at \(web.frame.minY), offset \(web.scrollView.contentOffset.y), inset \(web.scrollView.adjustedContentInset.top)/\(web.scrollView.adjustedContentInset.bottom); page \(page)"
		step("layout \(when): \(detail)")
		if let shot { try await mac("shot \(shot)") }
		// Half a point for the rounding between the page's pixels and the window's points.
		check("insets \(when): the header lies below the status bar", header.map { $0 >= top - 0.5 } ?? false, true, detail: detail)
		check("insets \(when): the composer lies whole above the \(keyboard.top == nil ? "home indicator" : "keyboard")", composer.map { $0 <= bottom + 0.5 } ?? false, true, detail: detail)
	}

	/**
	 * The phone turned on its side, the side bar opened: the sheet's content starts at or right of the
	 * safe area's left edge (the sensor housing lies on one side, and the safe area is kept on both).
	 * Then the sheet is put away and the phone turned back.
	 */
	private func sideways(_ vc: PineViewController) async throws {
		let scene = try XCTUnwrap(vc.view.window?.windowScene)
		scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeLeft))
		try await waitFor("the phone on its side") { scene.interfaceOrientation.isLandscape }
		try await settle()
		_ = try await agentsShown()
		try await settle()
		let measured = try await js("""
			const p = document.createElement('div');
			p.style.cssText = 'position:fixed;visibility:hidden;padding-left:env(safe-area-inset-left)';
			document.body.append(p);
			const safe = parseFloat(getComputedStyle(p).paddingLeft);
			p.remove();
			const sheet = document.querySelector('[data-slot=sidebar][data-mobile][data-side=left]');
			const lefts = sheet ? [...sheet.querySelectorAll('[data-slot=agent-label]')].map((e) => e.getBoundingClientRect().left) : [];
			return JSON.stringify({ safe, left: lefts.length ? Math.min(...lefts) : null, width: innerWidth });
			""") as? String ?? "{}"
		let m = try JSONSerialization.jsonObject(with: Data(measured.utf8)) as? [String: Any] ?? [:]
		let safe = (m["safe"] as? NSNumber)?.doubleValue ?? 0
		let left = (m["left"] as? NSNumber)?.doubleValue
		try await mac("shot landscape-sidebar.png")
		check("landscape: the safe area has a left inset", safe > 0, true, detail: measured)
		check("landscape: the side bar's content lies right of the sensor housing", left.map { $0 >= safe - 0.5 } ?? false, true, detail: measured)
		try await until("the side bar put away", "(() => { const open = document.querySelector('[data-slot=sidebar][data-mobile]'); open && document.querySelector('[aria-label=\"Hide the sidebar\"]')?.click(); return !open; })()")
		scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait))
		try await waitFor("the phone upright again") { scene.interfaceOrientation.isPortrait }
		try await settle()
	}

	private func webViews(in view: UIView?) -> Int {
		guard let view else { return 0 }
		return (view is WKWebView ? 1 : 0) + view.subviews.reduce(0) { $0 + webViews(in: $1) }
	}

	/** Asks the Mac for something only it can do (a screenshot, the app sent to the background) and waits for it to be done. */
	private func mac(_ command: String) async throws {
		asked += 1
		let done = dir.appendingPathComponent("done-\(asked)")
		try command.write(to: dir.appendingPathComponent("ask-\(asked)"), atomically: true, encoding: .utf8)
		try await waitFor("the Mac to \(command)", seconds: 60) { FileManager.default.fileExists(atPath: done.path) }
	}

	/** The status bar's style and the colour under it (the window's top left corner), for a theme of the machine's pine. */
	private func bars(_ vc: PineViewController, theme: String, dark: Bool, shot: String) async throws {
		let bg = try await js("return (await window.pine.call('GET', '/themes')).data.themes.find((t) => t.id === \(quoted(theme)))?.colors?.bg?.slice(0, 7).toLowerCase()") as? String ?? "none"
		var colour = ""
		let style: UIStatusBarStyle = dark ? .lightContent : .darkContent
		try? await waitFor("the status bar in \(bg) (\(theme))") {
			colour = topLeft(vc.view.window)
			return near(colour, bg) && vc.preferredStatusBarStyle == style
		}
		check("status bar: \(dark ? "light icons on the dark" : "dark icons on the light") theme \(theme)", vc.preferredStatusBarStyle == style, true)
		check("status bar: the colour under it is the theme's (\(theme))", near(colour, bg), true, detail: "\(colour), the theme's \(bg)")
		try await mac("shot \(shot)")
	}

	/**
	 * Two #rrggbb colours a few steps apart at most in each channel. What the screen draws goes through a
	 * colour space of its own; and the page focuses its message box when it starts, so that WebKit pushes it
	 * up above the keyboard and the top of the page's own surface (a shade off its background) lies under the bar.
	 */
	private func near(_ a: String, _ b: String) -> Bool {
		let channels = { (c: String) in stride(from: 1, to: 7, by: 2).compactMap { i in c.count == 7 ? Int(c.dropFirst(i).prefix(2), radix: 16) : nil } }
		let (x, y) = (channels(a), channels(b))
		return x.count == 3 && y.count == 3 && zip(x, y).allSatisfy { abs($0 - $1) <= 6 }
	}

	private func topLeft(_ window: UIWindow?) -> String {
		guard let window else { return "" }
		let format = UIGraphicsImageRendererFormat()
		format.scale = 1
		let shot = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
			window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
		}
		// The pixel at (2, 2), drawn into one pixel of a known layout: the first row and column may be an edge's blend.
		var rgba = [UInt8](repeating: 0, count: 4)
		guard let cg = shot.cgImage, let one = CGContext(data: &rgba, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return "" }
		one.draw(cg, in: CGRect(x: -2, y: -CGFloat(cg.height) + 3, width: CGFloat(cg.width), height: CGFloat(cg.height)))
		return "#" + rgba.prefix(3).map { String(format: "%02x", $0) }.joined()
	}

	/** One of WebKit's objects that only WebKit makes (a frame, an origin), to ask the delegate with: it reads neither. */
	private func made<T>(_ type: T.Type) throws -> T {
		guard let cls = NSClassFromString(String(describing: type)) as? NSObject.Type, let made = cls.init() as? T else { throw Missing(what: "a \(type)") }
		kept.append(made as AnyObject)
		return made
	}

	private func quoted(_ s: String) -> String {
		String(decoding: try! JSONSerialization.data(withJSONObject: [s]), as: UTF8.self).dropFirst().dropLast().description
	}
}

/** The on-screen keyboard's top in the window's points while it is up, nil while it is down, from the system's notices. */
@MainActor
private final class Keyboard {
	private(set) var top: CGFloat?
	private var watching: [NSObjectProtocol] = []

	func watch() {
		guard watching.isEmpty else { return }
		let center = NotificationCenter.default
		watching.append(center.addObserver(forName: UIResponder.keyboardDidShowNotification, object: nil, queue: .main) { [weak self] note in
			let frame = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue
			MainActor.assumeIsolated { self?.top = frame?.minY }
		})
		watching.append(center.addObserver(forName: UIResponder.keyboardDidHideNotification, object: nil, queue: .main) { [weak self] _ in
			MainActor.assumeIsolated { self?.top = nil }
		})
	}
}

/** A scheme task of the test's own: what the media scheme answers, recorded. */
private final class Recorded: NSObject, WKURLSchemeTask {
	let request: URLRequest
	var response: HTTPURLResponse?
	var body = Data()
	var done: CheckedContinuation<Void, Never>?

	init(_ request: URLRequest) {
		self.request = request
	}

	var status: Int { response?.statusCode ?? 0 }
	func header(_ name: String) -> String? { response?.value(forHTTPHeaderField: name) }
	func didReceive(_ response: URLResponse) { self.response = response as? HTTPURLResponse }
	func didReceive(_ data: Data) { body.append(data) }
	func didFinish() { end() }
	func didFailWithError(_ error: Error) { end() }

	private func end() {
		done?.resume()
		done = nil
	}
}

private extension MediaScheme {
	@MainActor func answer(_ request: URLRequest, in web: WKWebView) async -> Recorded {
		let task = Recorded(request)
		await withCheckedContinuation { (go: CheckedContinuation<Void, Never>) in
			task.done = go
			self.webView(web, start: task)
		}
		return task
	}
}

private struct Missing: Error, CustomStringConvertible {
	let what: String
	var description: String { "not seen: \(what)" }
}
