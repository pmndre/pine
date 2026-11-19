import Testing
import PineCore

// What names the other machine, and where its daemon may answer: src/remote.test.ts, on the phone.
// The cases are mobile/cases/hosts.json and loopback.json.
struct HostsTests {
	@Test("a host is a host, user@host or user@host:port, and never an option", arguments: try cases("hosts"))
	func host(_ c: Case) throws {
		let input = c.text("input")
		switch c.expect {
		case nil:
			#expect(try sshHost(input) == nil)
		case let e as [String: Any] where e["error"] != nil:
			do {
				_ = try sshHost(input)
				Issue.record("\(input ?? "nil") was taken")
			} catch let error as RemoteError {
				#expect(error.kind == e["error"] as! String)
			}
		case let e as [String: Any]:
			let want = SshHost(given: e["given"] as! String, user: plain(e["user"]) as! String?, host: e["host"] as! String, port: e["port"] as! Int, label: e["label"] as! String)
			#expect(try sshHost(input) == want)
		default:
			Issue.record("hosts.json: an expectation that is not null or an object")
		}
	}

	@Test("the daemon is reached at the other machine's loopback, and nowhere else", arguments: try cases("loopback"))
	func loopback(_ c: Case) throws {
		let input = c.text("input")!
		let e = c.expect as! [String: Any]
		if let kind = e["error"] as? String {
			do {
				_ = try loopbackEnd(input)
				Issue.record("\(input) was taken")
			} catch let error as RemoteError {
				#expect(error.kind == kind)
			}
		} else {
			let end = try loopbackEnd(input)
			#expect(end == Loopback(host: e["host"] as! String, port: e["port"] as! Int))
			#expect(end.hostHeader == e["hostHeader"] as! String)
		}
	}
}
