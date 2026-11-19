package pine.mobile.core

import org.json.JSONObject
import org.junit.jupiter.api.TestFactory
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

// What names the other machine, and where its daemon may answer: src/remote.test.ts, on the phone.
// The cases are mobile/cases/hosts.json and loopback.json.
class HostsTest {
	@TestFactory
	fun `a host is a host, user@host or user@host-port, and never an option`() = replay("hosts") { case ->
		val input = case.text("input")
		val expect = plain(android(case.opt("expect")))
		when {
			expect == null -> assertNull(sshHost(input))
			expect is JSONObject && expect.has("error") -> assertEquals(expect.getString("error"), assertFailsWith<RemoteError> { sshHost(input) }.kind)
			else -> {
				expect as JSONObject
				assertEquals(SshHost(expect.getString("given"), expect.text("user"), expect.getString("host"), expect.getInt("port"), expect.getString("label")), sshHost(input))
			}
		}
	}

	@TestFactory
	fun `the daemon is reached at the other machine's loopback, and nowhere else`() = replay("loopback") { case ->
		val input = case.getString("input")
		val expect = android(case.get("expect")) as JSONObject
		if (expect.has("error")) {
			assertEquals(expect.getString("error"), assertFailsWith<RemoteError> { loopbackEnd(input) }.kind)
		} else {
			val end = loopbackEnd(input)
			assertEquals(Loopback(expect.getString("host"), expect.getInt("port")), end)
			assertEquals(expect.getString("hostHeader"), end.hostHeader)
		}
	}
}
