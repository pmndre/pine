import Foundation
import Testing
@testable import PineCore

/** What the reader of the event stream told, as it told it. */
final class Heard: EventHandlers, @unchecked Sendable {
	private let lock = NSLock()
	private var _batches: [[Any]] = []
	private var _ups: [Bool] = []
	private var _losses: [Int] = []
	private let stopAt: Int?

	init(stopAt: Int? = nil) {
		self.stopAt = stopAt
	}

	var batches: [[Any]] { lock.withLock { _batches } }
	var ups: [Bool] { lock.withLock { _ups } }
	var losses: [Int] { lock.withLock { _losses } }
	var numbers: [Int] { batches.flatMap { $0 }.compactMap { ($0 as? [String: Any])?["n"] as? Int } }

	func batch(_ events: [Any]) { lock.withLock { _batches.append(events) } }
	func connection(_ up: Bool) { lock.withLock { _ups.append(up) } }
	func lost(_ times: Int) -> Bool {
		lock.withLock { _losses.append(times) }
		return times == stopAt
	}
}

/** An event stream's head, then `frames`, flushed one by one. */
func stream(_ x: Exchange, _ frames: String...) {
	x.head(200, ["content-type": "text/event-stream"], length: 0)
	for f in frames { x.write(f) }
}

// The daemon's live events, as EventsTest.kt (and desktop/electron/daemon.test.ts for `followEvents`)
// proves them: in batches, malformed frames skipped, a connection flag on each change, and a retry
// after a loss.
struct EventsTests {
	@Test("the event stream comes in batches, malformed frames skipped")
	func batches() async throws {
		try await withRig { rig in
			let hold = Hold()
			defer { hold.release() }
			rig.daemon[route: "/events/stream"] = { x in
				stream(x, ": connected\n\n", "data: {\"n\":1}\n\n", "data: {nope\n\n", ": ping\n\n", "data: {\"n\":2}\n\n")
				await hold.wait()
			}
			let heard = Heard()
			let following = followEvents(try await rig.connected(), heard)
			defer { following.stop() }
			try await eventually("two events") { heard.numbers.count == 2 }
			#expect(heard.numbers == [1, 2])
			#expect(heard.batches.count == 1, "events that come together are handed on together")
			#expect(heard.ups == [true])
			let seen = try #require(rig.daemon.seen.first)
			#expect(rig.daemon.seen.count == 1)
			#expect(seen.url == "/events/stream?topic=%23")
			#expect(seen.header("authorization") == "Bearer secret-token")
			#expect(seen.header("origin") == nil)
		}
	}

	@Test("a lost stream says so, and is opened again")
	func again() async throws {
		try await withRig { rig in
			// Each stream gives one event and ends.
			rig.daemon[route: "/events/stream"] = { x in stream(x, ": connected\n\n", "data: {\"n\":1}\n\n") }
			let heard = Heard()
			let following = followEvents(try await rig.connected(), heard, retry: .milliseconds(50))
			defer { following.stop() }
			try await eventually("open, lost and open again") { heard.ups.count >= 3 }
			#expect(Array(heard.ups.prefix(3)) == [true, false, true])
			try await eventually("an event from each stream") { heard.numbers.count >= 2 }
		}
	}

	@Test("each loss in a row is counted, and the caller can stop the reading")
	func losses() async throws {
		try await withRig { rig in
			rig.daemon[route: "/events/stream"] = { x in x.head(500, length: -1) }
			let heard = Heard(stopAt: 3)
			let following = followEvents(try await rig.connected(), heard, retry: .milliseconds(20))
			defer { following.stop() }
			try await eventually("three losses") { heard.losses.count == 3 }
			try await Task.sleep(for: .milliseconds(150))
			#expect(heard.losses == [1, 2, 3])
			#expect(rig.daemon.seen.count == 3)
			#expect(heard.ups == [false, false, false])
		}
	}

	@Test("stopping ends the reading and hands on nothing more")
	func stopping() async throws {
		try await withRig { rig in
			let hold = Hold()
			defer { hold.release() }
			rig.daemon[route: "/events/stream"] = { x in
				stream(x, ": connected\n\n")
				await hold.wait()
			}
			let heard = Heard()
			let following = followEvents(try await rig.connected(), heard, retry: .milliseconds(20))
			try await eventually("open") { !heard.ups.isEmpty }
			following.stop()
			try await Task.sleep(for: .milliseconds(150))
			#expect(heard.ups == [true])
			#expect(rig.daemon.seen.count == 1)
		}
	}
}
