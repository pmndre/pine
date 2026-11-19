package pine.mobile.core

import org.junit.jupiter.api.TestFactory
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Pictures, video and sound straight from the daemon, as desktop/electron/daemon.test.ts proves
// `mediaFromDaemon` for the Mac: only the listed paths, only what is drawn or played. The cases are
// mobile/cases/media-paths.json and media-types.json.
class MediaTest {
	private val rig = Rig()

	init {
		rig.daemon.routes["/media/tool/pic"] = { x ->
			x.responseHeaders.add("content-type", "image/png")
			x.sendResponseHeaders(200, StandInDaemon.PNG.size.toLong())
			x.responseBody.write(StandInDaemon.PNG)
		}
		rig.daemon.routes["/media/tool/clip"] = { x ->
			// Sent in chunks, without a length: none is claimed.
			x.responseHeaders.add("content-type", "video/mp4")
			x.sendResponseHeaders(200, 0)
			x.responseBody.write("MP4".toByteArray())
		}
		rig.daemon.routes["/media/tool/page"] = { x ->
			x.responseHeaders.add("content-type", "text/html")
			x.sendResponseHeaders(200, 0)
			x.responseBody.write("<script>".toByteArray())
		}
		rig.daemon.routes["/media/tool/drawing"] = { x ->
			x.responseHeaders.add("content-type", "image/svg+xml")
			x.sendResponseHeaders(200, 0)
			x.responseBody.write("<svg/>".toByteArray())
		}
		rig.daemon.routes["/media/tool/gone"] = { x -> x.sendResponseHeaders(404, -1) }
	}

	@AfterTest
	fun end() = rig.close()

	private fun MediaAnswer.text() = body.use { it.readBytes().toString(Charsets.UTF_8) }

	@Test
	fun `only the listed paths, and only what is drawn or played`() {
		assertTrue(MEDIA.any { it.matches("/media/tool/pic") })
		val s = rig.connected()
		val ok = mediaFromDaemon(s, "GET", "/media/tool/pic", "?v=1")
		assertEquals(200, ok.status)
		assertEquals(StandInDaemon.PNG.toList(), ok.body.use { it.readBytes() }.toList())
		assertEquals("image/png", ok.headers["content-type"])
		assertEquals("no-store", ok.headers["cache-control"])
		assertEquals("nosniff", ok.headers["x-content-type-options"])
		assertEquals("${StandInDaemon.PNG.size}", ok.headers["content-length"])
		val seen = rig.daemon.seen.single()
		assertEquals("/media/tool/pic?v=1", seen.url)
		assertEquals("GET", seen.method)
		assertEquals("Bearer secret-token", seen.header("authorization"))
		assertNull(seen.header("origin"))

		val clip = mediaFromDaemon(s, "GET", "/media/tool/clip", "")
		assertEquals(200, clip.status)
		assertEquals("MP4", clip.text())
		assertNull(clip.headers["content-length"])

		assertEquals(415, mediaFromDaemon(s, "GET", "/media/tool/page", "").status)
		assertEquals(415, mediaFromDaemon(s, "GET", "/media/tool/drawing", "").status)
		assertEquals(404, mediaFromDaemon(s, "GET", "/media/tool/gone", "").status)
	}

	@Test
	fun `before a daemon there are no media`() {
		assertEquals(404, mediaFromDaemon(null, "GET", "/media/tool/pic", "").status)
	}

	@TestFactory
	fun `what is not one of the daemon's media never leaves the phone`() = replay("media-paths") { case ->
		val asked = Asked()
		val r = mediaFromDaemon(asked, case.getString("method"), case.getString("path"), case.getString("search"))
		assertEquals(android(case.get("expect")), asked.opened)
		if (!asked.opened) {
			assertEquals(404, r.status)
			assertEquals("not found", r.text())
		}
	}

	@TestFactory
	fun `only what is drawn or played reaches the page`() = replay("media-types") { case ->
		val answer = Answering(case.getInt("status"), case.text("contentType"))
		val r = mediaFromDaemon(answer, "GET", "/media/tool/pic", "")
		assertEquals(android(case.get("expect")), r.status)
		assertEquals("GET /media/tool/pic HTTP/1.1", answer.request.toString(Charsets.ISO_8859_1).substringBefore("\r\n"))
	}

	/** A daemon that notes whether it was asked anything, and answers nothing. */
	private class Asked : Daemon {
		var opened = false
		override val token = "secret-token"
		override val end = Loopback("127.0.0.1", 7463)
		override fun open(): Duplex {
			opened = true
			throw IOException("nobody")
		}
	}

	/** A daemon that answers every request with a status and a content type, and an empty body. */
	private class Answering(status: Int, type: String?) : Daemon {
		val request = ByteArrayOutputStream()
		private val answer = "HTTP/1.1 $status X\r\n${type?.let { "Content-Type: $it\r\n" } ?: ""}Content-Length: 0\r\n\r\n".toByteArray(Charsets.ISO_8859_1)
		override val token = "secret-token"
		override val end = Loopback("127.0.0.1", 7463)
		override fun open(): Duplex = object : Duplex {
			override val input = ByteArrayInputStream(answer)
			override val output = request
			override fun close() {}
		}
	}
}
