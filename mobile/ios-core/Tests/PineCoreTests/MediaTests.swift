import Testing
import PineCore

// Pictures, video and sound straight from the daemon, as desktop/electron/daemon.test.ts proves
// `mediaFromDaemon` for the Mac: only the listed paths, only what is drawn or played. The cases are
// mobile/cases/media-paths.json and media-types.json.
struct MediaTests {
	@Test("what is not one of the daemon's media never leaves the phone", arguments: try cases("media-paths"))
	func asked(_ c: Case) {
		#expect(mediaAsked(method: c.text("method")!, path: c.text("path")!, search: c.text("search")!) == c.expect as! Bool)
	}

	@Test("only what is drawn or played reaches the page", arguments: try cases("media-types"))
	func shown(_ c: Case) {
		#expect(mediaShown(status: c.fields["status"] as! Int, contentType: c.text("contentType")) == c.expect as! Int)
	}

	@Test("what is shown is never cached or sniffed, and keeps its length when it has one")
	func headers() {
		#expect(mediaHeaders(contentType: "image/png", contentLength: "68") == ["content-type": "image/png", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-length": "68"])
		#expect(mediaHeaders(contentType: "video/mp4", contentLength: nil) == ["content-type": "video/mp4", "cache-control": "no-store", "x-content-type-options": "nosniff"])
	}
}
