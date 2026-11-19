package pine.mobile.core

import com.sun.net.httpserver.HttpExchange
import org.json.JSONObject
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

// The daemon's live events, as desktop/electron/daemon.test.ts proves `followEvents` for the Mac:
// in batches, malformed frames skipped, a connection flag on each change, and a retry after a loss.
class EventsTest {
	private val rig = Rig()
	private val hold = CountDownLatch(1)
	private val batches = Collections.synchronizedList(mutableListOf<List<Any>>())
	private val ups = Collections.synchronizedList(mutableListOf<Boolean>())

	@AfterTest
	fun end() {
		hold.countDown()
		rig.close()
	}

	private fun stream(x: HttpExchange, vararg frames: String) {
		x.responseHeaders.add("content-type", "text/event-stream")
		x.sendResponseHeaders(200, 0)
		for (f in frames) {
			x.responseBody.write(f.toByteArray())
			x.responseBody.flush()
		}
	}

	private fun handlers(lost: (Int) -> Boolean = { false }) = object : EventHandlers {
		override fun batch(events: List<Any>) {
			batches.add(events)
		}
		override fun connection(up: Boolean) {
			ups.add(up)
		}
		override fun lost(times: Int) = lost(times)
	}

	private fun numbers() = synchronized(batches) { batches.flatten().map { (it as JSONObject).getInt("n") } }

	@Test
	fun `the event stream comes in batches, malformed frames skipped`() {
		rig.daemon.routes["/events/stream"] = { x ->
			stream(x, ": connected\n\n", "data: {\"n\":1}\n\n", "data: {nope\n\n", ": ping\n\n", "data: {\"n\":2}\n\n")
			hold.await(5, TimeUnit.SECONDS)
		}
		rig.held(followEvents(rig.connected(), handlers()))
		eventually("two events") { numbers().size == 2 }
		assertEquals(listOf(1, 2), numbers())
		assertEquals(1, batches.size, "events that come together are handed on together")
		assertEquals(listOf(true), ups.toList())
		val seen = rig.daemon.seen.single()
		assertEquals("/events/stream?topic=%23", seen.url)
		assertEquals("Bearer secret-token", seen.header("authorization"))
		assertNull(seen.header("origin"))
	}

	@Test
	fun `a lost stream says so, and is opened again`() {
		// Each stream gives one event and ends.
		rig.daemon.routes["/events/stream"] = { x -> stream(x, ": connected\n\n", "data: {\"n\":1}\n\n") }
		rig.held(followEvents(rig.connected(), handlers(), retryMs = 50))
		eventually("open, lost and open again") { ups.size >= 3 }
		assertEquals(listOf(true, false, true), ups.take(3))
		eventually("an event from each stream") { numbers().size >= 2 }
	}

	@Test
	fun `each loss in a row is counted, and the caller can stop the reading`() {
		rig.daemon.routes["/events/stream"] = { x -> x.sendResponseHeaders(500, -1) }
		val times = Collections.synchronizedList(mutableListOf<Int>())
		rig.held(followEvents(rig.connected(), handlers { n -> times.add(n); n == 3 }, retryMs = 20))
		eventually("three losses") { times.size == 3 }
		Thread.sleep(150)
		assertEquals(listOf(1, 2, 3), times.toList())
		assertEquals(3, rig.daemon.seen.size)
		assertEquals(listOf(false, false, false), ups.toList())
	}

	@Test
	fun `stopping ends the reading and hands on nothing more`() {
		rig.daemon.routes["/events/stream"] = { x ->
			stream(x, ": connected\n\n")
			hold.await(5, TimeUnit.SECONDS)
		}
		val following = followEvents(rig.connected(), handlers(), retryMs = 20)
		eventually("open") { ups.isNotEmpty() }
		following.stop()
		Thread.sleep(150)
		assertEquals(listOf(true), ups.toList())
		assertEquals(1, rig.daemon.seen.size)
	}
}
