// A pine on another machine, reached over SSH: `connectRemote` of src/remote.ts on the phone. One
// SSH session per machine runs `pine service` there (the very command src/remote.ts builds, read
// from remote-command.txt, which src/remote.test.ts holds equal to it), reads its one line,
// and keeps the session's stdin open as the leash of a daemon it started. Calls go through a
// `direct-tcpip` channel of that session each.
package pine.mobile.core

import net.schmizz.sshj.DefaultConfig
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.connection.channel.direct.Session
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import net.schmizz.sshj.userauth.UserAuthException
import net.schmizz.keepalive.KeepAliveProvider
import net.schmizz.keepalive.KeepAliveRunner
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.SocketTimeoutException
import java.security.PublicKey
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** What runs on the other machine: src/remote.ts's `remoteCommand()`, character for character. */
val REMOTE_COMMAND: String = Remote::class.java.getResource("remote-command.txt")!!.readText()

/** A daemon on another machine, held by one SSH session. */
class RemoteService internal constructor(
	/** The machine as the owner wrote it. */
	val host: String,
	/** A short name for it: the host name without the user and the domain. */
	val label: String,
	override val token: String,
	/** `pine service` there started the daemon, which this session holds by its stdin: it stops when the session ends. */
	val started: Boolean,
	/** The home of that pine, on that machine. */
	val home: String,
	val version: String?,
	override val end: Loopback,
	private val ssh: SSHClient,
	private val command: Session.Command,
	private val session: Session,
) : Daemon {
	/** Whether the session still stands. */
	val isOpen: Boolean get() = ssh.isConnected && command.isOpen

	override fun open(): Duplex {
		val channel = ssh.newDirectConnection(end.host, end.port)
		return object : Duplex {
			// Buffered once here: what reads it (heads, bodies, the event stream) reads a byte at a time.
			override val input: InputStream = channel.inputStream.buffered()
			override val output: OutputStream = channel.outputStream
			override fun close() = channel.close()
		}
	}

	/** One call of the control API: `callDaemon` with this daemon. */
	fun call(method: String, url: String, body: Any?): CallResult = callDaemon(this, method, url, body)

	/** Ends the session: its stdin first, so that a daemon it started stops, then the connection. */
	fun stop() {
		runCatching { command.outputStream.close() }
		runCatching { command.join(2, TimeUnit.SECONDS) }
		runCatching { session.close() }
		runCatching { ssh.disconnect() }
	}
}

/**
 * Connects to other machines with the phone's key, and only to those whose host key the owner
 * confirmed. `answerMs` is how long `pine service` there has to say where its daemon answers;
 * `connectMs` how long the machine has to answer at all (ssh's ConnectTimeout).
 */
class Remote(
	private val key: DeviceKey,
	private val known: KnownHosts,
	private val answerMs: Long = 60_000,
	private val connectMs: Int = 15_000,
	/**
	 * How long a read on a channel waits for a byte: a daemon that takes a call and never answers
	 * fails it then. The event stream is read under it too, which the daemon's ping every 20 seconds keeps alive.
	 */
	private val readMs: Int = 60_000,
) {
	/** The daemon of the machine `value` names (host, user@host or user@host:port), or a `RemoteError` that says what to do. */
	fun connect(value: String): RemoteService {
		val named = sshHost(value) ?: throw RemoteError("ssh", "Name the machine as you would after ssh: user@host, or user@host:port.")
		val user = named.user ?: throw RemoteError("ssh", "Name the user too: user@${named.given}. A phone has no user name of its own to sign in with.")
		val given = named.given
		val config = DefaultConfig().apply {
			keepAliveProvider = KeepAliveProvider.KEEP_ALIVE
			channelReadTimeoutMs = readMs
		}
		val ssh = SSHClient(config)
		var refusedKey: RemoteError? = null
		ssh.addHostKeyVerifier(object : HostKeyVerifier {
			override fun verify(hostname: String, port: Int, key: PublicKey): Boolean = try {
				known.check(given, named.host, named.port, key)
				true
			} catch (e: RemoteError) {
				refusedKey = e
				false
			}
			override fun findExistingAlgorithms(hostname: String, port: Int): List<String> = emptyList()
		})
		ssh.connectTimeout = connectMs
		// A link that died is noticed in under a minute, as ServerAliveInterval=15 and ServerAliveCountMax=3 do.
		(ssh.connection.keepAlive as? KeepAliveRunner)?.maxAliveCount = 3
		ssh.connection.keepAlive.keepAliveInterval = 15
		try {
			try {
				ssh.connect(named.host, named.port)
			} catch (e: IOException) {
				refusedKey?.let { throw it }
				throw RemoteError("ssh", "Could not connect to $given over SSH (${e.message ?: e.javaClass.simpleName}). Check that this phone reaches that machine (the same Wi-Fi, or a VPN such as Tailscale on both), that SSH runs there, and that the port is right.")
			}
			try {
				ssh.authPublickey(user, key.provider())
			} catch (e: UserAuthException) {
				throw RemoteError("ssh", "Could not connect to $given over SSH: it did not take this phone's key for $user. Add the app's public key to ~/.ssh/authorized_keys of $user there, then try again.")
			}
			val session = ssh.startSession()
			val command = session.exec(REMOTE_COMMAND)
			val err = StringBuilder()
			val reader = thread(isDaemon = true, name = "pine-ssh-stderr") {
				val buf = ByteArray(4096)
				runCatching {
					while (true) {
						val n = command.errorStream.read(buf)
						if (n < 0) break
						synchronized(err) {
							err.append(String(buf, 0, n, Charsets.UTF_8))
							if (err.length > 4000) err.delete(0, err.length - 4000)
						}
					}
				}
			}
			val line = firstLine(command.inputStream)
			val said = try {
				line.get(answerMs, TimeUnit.MILLISECONDS)
			} catch (e: Exception) {
				null
			}
			if (said == null) {
				// No line: the command ended (wait for its code and the last of stderr), or it says nothing.
				val ended = line.isDone
				if (ended) runCatching { command.join(5, TimeUnit.SECONDS) }
				reader.join(if (ended) 2_000 else 200)
				val stderr = synchronized(err) { err.toString() }
				if (Regex("unknown command \"service\"").containsMatchIn(stderr)) throw RemoteError("ssh", "The pine on $given is too old to be reached this way: it has no \"service\" command. Update it there with \"pine update\", then try again.")
				throw RemoteError("ssh", trouble(given, if (ended) "exit" else "timeout", command.exitStatus?.toString() ?: "", stderr))
			}
			val answer = try {
				JSONObject(said)
			} catch (e: Exception) {
				throw RemoteError("ssh", trouble(given, "garbage", said.take(200), ""))
			}
			if (answer.has("error")) throw RemoteError("failed", "The pine on ${named.label} did not start: ${answer.opt("error")}")
			val end = loopbackEnd(answer.optString("base"))
			val token = answer.optString("token")
			if (token.isEmpty() || token.any { it.isISOControl() || it.isWhitespace() }) throw RemoteError("failed", "The pine on ${named.label} gave no token that can be sent.")
			return RemoteService(
				host = given,
				label = named.label,
				token = token,
				started = answer.optBoolean("started", false),
				home = answer.optString("home").ifEmpty { "~/.pine" },
				version = answer.opt("version") as? String,
				end = end,
				ssh = ssh,
				command = command,
				session = session,
			)
		} catch (e: Exception) {
			runCatching { ssh.disconnect() }
			throw e
		}
	}
}

/** The first line the command writes, as a future: null when it ends before one. */
private fun firstLine(input: InputStream): CompletableFuture<String?> {
	val result = CompletableFuture<String?>()
	thread(isDaemon = true, name = "pine-ssh-line") {
		val line = ByteArrayOutputStream()
		try {
			while (true) {
				val b = input.read()
				if (b < 0) break
				if (b == '\n'.code) {
					result.complete(line.toString(Charsets.UTF_8))
					return@thread
				}
				if (line.size() < 64 * 1024) line.write(b)
			}
			result.complete(null)
		} catch (e: SocketTimeoutException) {
			// A command that says nothing for a while: `answerMs` decides when that is too long.
		} catch (e: Exception) {
			result.complete(null)
		}
	}
	return result
}

/** What went wrong, in the words of `sshTrouble` in src/remote.ts. */
private fun trouble(host: String, failed: String, detail: String, err: String): String {
	val said = err.replace(Regex("(?m)^#.*\\n?"), "").trim().takeLast(500)
	val check = Regex("https://login\\.tailscale\\.com/\\S+").find(err)?.value
	if (failed == "timeout") return if (check != null) "Tailscale SSH wants you to confirm it is you before $host lets you in. Open $check, sign in, then try again." else "$host did not answer over SSH within a minute.${if (said.isNotEmpty()) " It said: $said" else ""}"
	if (failed == "garbage") return "$host answered with something that is not pine's service line: $detail"
	if (detail == "127") return "pine is not installed on $host, or not on the PATH of its login shell. $said".trim()
	return said.ifEmpty { "SSH to $host ended (exit ${detail.ifEmpty { "unknown" }}) without saying why." }
}
