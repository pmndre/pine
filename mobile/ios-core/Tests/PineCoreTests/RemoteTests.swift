import Foundation
import Testing
@testable import PineCore

// The pine of another machine over SSH, as RemoteTest.kt proves it for Android (and src/remote.test.ts
// and desktop/electron/daemon.test.ts for the Mac): what reaches the daemon and what the page gets back,
// through a real sshd. The service lines and the words of a failure are the shared cases, read here
// over SSH as well.
struct RemoteTests {
	@Test("it runs the command of src/remote.ts, reads the service line and holds the daemon by stdin")
	func leash() async throws {
		try await withRig { rig in
			let s = try await rig.connected()
			#expect(rig.machine.commands == 1)
			#expect(s.token == "secret-token")
			#expect(s.home == "/home/me/.pine")
			#expect(s.version == "0.40.0")
			#expect(!s.started)
			#expect(s.label == "127.0.0.1")
			#expect(s.host == rig.host)
			#expect(s.isOpen)
			try await Task.sleep(for: .milliseconds(200))
			#expect(rig.machine.leashesEnded == 0, "stdin is held while connected")
			await s.stop()
			try await eventually("stopping ends the session's stdin") { rig.machine.leashesEnded == 1 }
			#expect(!s.isOpen)
		}
	}

	@Test("a call carries the token, no Origin, and the loopback as Host, through a channel of the session")
	func call() async throws {
		try await withRig { rig in
			let s = try await rig.connected()
			let r = await s.call(method: "POST", url: "/agents/main/message?x=1", body: ["text": "hello"])
			#expect(r.ok)
			#expect(r.status == 200)
			#expect((r.data as? [String: Any])?["method"] as? String == "POST")
			let seen = try #require(rig.daemon.seen.last)
			#expect(seen.url == "/agents/main/message?x=1")
			#expect(seen.header("authorization") == "Bearer secret-token")
			#expect(seen.header("content-type") == "application/json")
			#expect(seen.body == #"{"text":"hello"}"#)
			#expect(seen.header("host") == String(rig.daemon.base.dropFirst("http://".count)))
			#expect(seen.header("connection") == "close")
			#expect(seen.header("origin") == nil)
			#expect(seen.header("sec-fetch-site") == nil)
			// Without a body, none is sent and no content type is claimed.
			_ = await s.call(method: "GET", url: "/agents")
			#expect(rig.daemon.seen.last?.header("content-type") == nil)
			#expect(rig.daemon.seen.last?.body == "")
			// A body that is a JSON value other than an object.
			_ = await s.call(method: "POST", url: "/x", body: "a/b")
			#expect(rig.daemon.seen.last?.body == #""a/b""#)
		}
	}

	@Test("answers come back as callDaemon gives them")
	func answers() async throws {
		try await withRig { rig in
			let s = try await rig.connected()
			#expect((await s.call(method: "GET", url: "/streamed").data as? [String: Any])?["streamed"] as? Bool == true)
			let missing = await s.call(method: "GET", url: "/missing")
			#expect(!missing.ok)
			#expect(missing.status == 404)
			#expect((missing.data as? [String: Any])?["error"] as? String == "not found")
			#expect((await s.call(method: "GET", url: "/broken").data as? [String: Any])?.isEmpty == true)
			// A picture: bytes and their kind.
			let picture = try #require(await s.call(method: "GET", url: "/picture").data as? [String: Any])
			#expect(picture["mime"] as? String == "image/png")
			#expect(Data(base64Encoded: picture["base64"] as! String) == Data(StandInDaemon.PNG))
		}
	}

	@Test("what is not a call of the control API is refused before it leaves the phone")
	func refused() async throws {
		try await withRig { rig in
			let s = try await rig.connected()
			for (method, url) in [("PUT", "/agents"), ("DELETE", "/agents"), ("GET", "agents"), ("GET", "//evil.example/x"), ("GET", ""), ("GET", "/a b"), ("GET", "/a\r\nOrigin: x")] {
				let r = await s.call(method: method, url: url)
				#expect(!r.ok)
				#expect(r.status == 400)
				#expect((r.data as? [String: Any])?["error"] as? String == "not a call of the control API")
			}
			#expect(rig.daemon.seen.isEmpty)
		}
	}

	@Test("before a daemon there is nothing to call, and a daemon that does not answer is status 0")
	func nobody() async throws {
		let before = await callDaemon(nil, method: "GET", url: "/agents")
		#expect(before.status == 503)
		#expect((before.data as? [String: Any])?["error"] as? String == "pine is not running yet")
		try await withRig { rig in
			rig.machine.behaviour = Machine.service(Rig.line("http://127.0.0.1:\(try freePort())"))
			let r = await try rig.connected().call(method: "GET", url: "/agents")
			#expect(!r.ok)
			#expect(r.status == 0)
			#expect(((r.data as? [String: Any])?["error"] as? String)?.hasPrefix("pine does not answer") == true)
		}
	}

	@Test("an unknown host key stops with its fingerprint, and once confirmed it connects")
	func unknownKey() async throws {
		try await withRig(confirmed: false) { rig in
			let e = try await #require(throws: RemoteError.self) { try await rig.remote.connect(rig.host) }
			let key = try #require(e.hostKey)
			#expect(e.kind == "ssh")
			#expect(!key.changed)
			#expect(key.fingerprint == rig.machine.fingerprint)
			#expect(e.message.contains(key.fingerprint))
			#expect(rig.machine.commands == 0, "nothing runs on a machine that was not confirmed")
			try rig.known.confirm(host: key.host, port: key.port, fingerprint: key.fingerprint)
			_ = try await rig.connected()
			#expect(rig.machine.commands == 1)
		}
	}

	@Test("a changed host key is refused until the stored one is forgotten")
	func changedKey() async throws {
		try await withRig { rig in
			await try rig.connected().stop()
			try await rig.machine.newHostKey()
			let e = try await #require(throws: RemoteError.self) { try await rig.remote.connect(rig.host) }
			#expect(e.hostKey?.changed == true)
			#expect(e.hostKey?.fingerprint == rig.machine.fingerprint)
			#expect(e.message.contains("changed"))
			#expect(rig.machine.commands == 1)
			// Confirming the new one while the old one is stored changes nothing: it is forgotten first.
			try rig.known.confirm(host: "127.0.0.1", port: rig.machine.port, fingerprint: rig.machine.fingerprint)
			#expect(try await #require(throws: RemoteError.self) { try await rig.remote.connect(rig.host) }.hostKey?.changed == true)
			try rig.known.forget(host: "127.0.0.1", port: rig.machine.port)
			#expect(try await #require(throws: RemoteError.self) { try await rig.remote.connect(rig.host) }.hostKey?.changed == false)
			try rig.confirm()
			_ = try await rig.connected()
			#expect(rig.machine.commands == 2)
		}
	}

	@Test("a key the machine does not take, a machine nobody answers at, and a host that is no host")
	func unreachable() async throws {
		try await withRig { rig in
			let stranger = Remote(key: DeviceKey(SharedStore()), known: rig.known, answer: .seconds(1))
			let refused = try await #require(throws: RemoteError.self) { try await stranger.connect(rig.host) }
			#expect(refused.kind == "ssh")
			#expect(refused.message == "Could not connect to \(rig.host) over SSH: it did not take this phone's key for \(rig.machine.user). Add the app's public key to ~/.ssh/authorized_keys of \(rig.machine.user) there, then try again.")
			let port = try freePort()
			let nobody = try await #require(throws: RemoteError.self) { try await rig.remote.connect("me@127.0.0.1:\(port)") }
			#expect(nobody.kind == "ssh")
			for words in ["Could not connect to me@127.0.0.1:\(port) over SSH", "Wi-Fi", "Tailscale", "port"] { #expect(nobody.message.contains(words)) }
			#expect(try await #require(throws: RemoteError.self) { try await rig.remote.connect("-oProxyCommand=x") }.kind == "ssh")
			#expect(try await #require(throws: RemoteError.self) { try await rig.remote.connect("127.0.0.1:\(rig.machine.port)") }.message.contains("user@"))
			#expect(rig.machine.commands == 0)
		}
	}

	@Test("why a machine cannot be reached is said in plain words, never as the error's type")
	func unreachableWords() async throws {
		let remote = Remote(key: DeviceKey(SharedStore()), known: KnownHosts(SharedStore()), connect: .seconds(5))
		let port = try freePort()
		let refused = try await #require(throws: RemoteError.self) { try await remote.connect("me@127.0.0.1:\(port)") }
		#expect(refused.message.hasPrefix("Could not connect to me@127.0.0.1:\(port) over SSH: nothing answers at port \(port) there."))
		let unknown = try await #require(throws: RemoteError.self) { try await remote.connect("me@no-such-machine.invalid") }
		#expect(unknown.message.hasPrefix("Could not connect to me@no-such-machine.invalid over SSH: no machine is known by the name no-such-machine.invalid."))
		for e in [refused, unknown] {
			#expect(!e.message.contains("NIO"))
			#expect(!e.message.contains("Error("))
			#expect(e.message.contains("Wi-Fi"))
		}
	}

	@Test("a machine that takes the connection and never speaks SSH is given up on")
	func silentMachine() async throws {
		let server = try StandInDaemon()
		defer { server.close() }
		let port = Int(server.base.split(separator: ":").last!)!
		let remote = Remote(key: DeviceKey(SharedStore()), known: KnownHosts(SharedStore()), connect: .milliseconds(300))
		let started = ContinuousClock.now
		let e = try await #require(throws: RemoteError.self) { try await remote.connect("me@127.0.0.1:\(port)") }
		#expect(e.message.hasPrefix("Could not connect to me@127.0.0.1:\(port) over SSH"))
		#expect(ContinuousClock.now - started < .seconds(3))
	}

	@Test("a daemon that takes a call and never answers fails it in a bounded time")
	func silentDaemon() async throws {
		try await withRig(read: .milliseconds(300)) { rig in
			let hold = Hold()
			defer { hold.release() }
			rig.daemon[route: "/silent"] = { _ in await hold.wait() }
			rig.daemon[route: "/media/tool/silent"] = { _ in await hold.wait() }
			let s = try await rig.connected()
			let started = ContinuousClock.now
			let r = await s.call(method: "GET", url: "/silent")
			#expect(r.status == 0)
			#expect(((r.data as? [String: Any])?["error"] as? String)?.hasPrefix("pine does not answer") == true)
			#expect(await mediaFromDaemon(s, method: "GET", path: "/media/tool/silent", search: "").status == 404)
			#expect(ContinuousClock.now - started < .seconds(3), "within the read time limit")
		}
	}

	// mobile/cases/service-lines.json, as `pine service` writes them over SSH.
	@Test("the service line is read over SSH as the shared cases say", arguments: try cases("service-lines"))
	func serviceLines(_ c: Case) async throws {
		try await withRig { rig in
			rig.machine.behaviour = "cat <<'LINE'\n\(c.text("line")!)\nLINE\ncat >/dev/null\n"
			let named = try sshHost(rig.host)!
			let expect = c.expect as! [String: Any]
			if let error = expect["error"] as? [String: Any] {
				let e = try await #require(throws: RemoteError.self) { try await rig.connected() }
				#expect(e.kind == error["kind"] as! String)
				#expect(e.message == (error["message"] as! String).filled(["given": named.given, "label": named.label]))
				return
			}
			let want = expect["service"] as! [String: Any]
			let s = try await rig.connected()
			#expect(s.token == want["token"] as! String)
			#expect(s.home == want["home"] as! String)
			#expect(s.version == plain(want["version"]) as! String?)
			#expect(s.started == want["started"] as! Bool)
			#expect(s.end == Loopback(host: want["host"] as! String, port: want["port"] as! Int))
		}
	}

	// mobile/cases/failures.json: pine missing, too old, a banner, a command that never answers.
	@Test("a command that gives no service line is said over SSH in the shared words", arguments: try cases("failures"))
	func failures(_ c: Case) async throws {
		let exit = plain(c.fields["exit"]) as! Int?
		// A command that never answers is given up on after the answer time; one that ends is not waited for that long.
		try await withRig(answer: exit == nil ? .seconds(2) : .seconds(10)) { rig in
			let stderr = c.text("stderr")!
			rig.machine.behaviour = "cat >&2 <<'ERR'\n\(stderr)ERR\n" + (exit.map { "exit \($0)\n" } ?? "cat >/dev/null\n")
			let e = try await #require(throws: RemoteError.self) { try await rig.connected() }
			let expect = c.expect as! [String: Any]
			#expect(e.kind == expect["kind"] as! String)
			#expect(e.message == (expect["message"] as! String).filled(["given": rig.host]))
		}
	}
}
