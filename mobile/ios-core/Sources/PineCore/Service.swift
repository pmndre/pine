// What `pine service` on the other machine says once SSH let the phone in: `connectRemote` and
// `sshTrouble` of src/remote.ts, as the service-line and failure parts of Remote.kt. The command
// itself is the file both cores read, mobile/cases/remote-command.txt.
import Foundation

/**
 * What runs on the other machine: src/remote.ts's `remoteCommand()`, character for character. The
 * package's resource is a link to mobile/cases/remote-command.txt (src/remote.test.ts holds
 * that file equal to `remoteCommand()`), copied into the bundle when the package is built.
 */
public let REMOTE_COMMAND: String = {
	let url = Bundle.module.url(forResource: "remote-command", withExtension: "txt")!
	return try! String(contentsOf: url, encoding: .utf8)
}()

/** Where the other machine's daemon answers and what it gave to reach it, from its service line. */
public struct ServiceLine: Equatable, Sendable {
	public let token: String
	/** The home of that pine, on that machine. */
	public let home: String
	public let version: String?
	/** `pine service` there started the daemon, which the session holds by its stdin: it stops when the session ends. */
	public let started: Bool
	public let end: Loopback
}

/** The one line `pine service` writes, read; a `RemoteError` in the words of src/remote.ts when it is not taken. */
public func serviceLine(_ line: String, named: SshHost) throws -> ServiceLine {
	guard let data = line.data(using: .utf8), let answer = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
		throw RemoteError("ssh", trouble(named.given, failed: "garbage", detail: String(line.prefix(200)), err: ""))
	}
	if let error = answer["error"], !(error is NSNull) {
		throw RemoteError("failed", "The pine on \(named.label) did not start: \(error as? String ?? String(describing: error))")
	}
	let end = try loopbackEnd(answer["base"] as? String ?? "")
	let token = answer["token"] as? String ?? ""
	if token.isEmpty || token.unicodeScalars.contains(where: { $0.properties.isWhitespace || $0.properties.generalCategory == .control }) {
		throw RemoteError("failed", "The pine on \(named.label) gave no token that can be sent.")
	}
	let home = answer["home"] as? String ?? ""
	return ServiceLine(
		token: token,
		home: home.isEmpty ? "~/.pine" : home,
		version: answer["version"] as? String,
		started: answer["started"] as? Bool ?? false,
		end: end
	)
}

/**
 * Why the command gave no service line, in words. `stderr` is what it wrote there; `exit` its exit
 * code, or nil when it did not end and said nothing on stdout within the answer time.
 */
public func failure(given: String, stderr: String, exit: Int?) -> RemoteError {
	if stderr.contains("unknown command \"service\"") {
		return RemoteError("ssh", "The pine on \(given) is too old to be reached this way: it has no \"service\" command. Update it there with \"pine update\", then try again.")
	}
	return RemoteError("ssh", trouble(given, failed: exit == nil ? "timeout" : "exit", detail: exit.map(String.init) ?? "", err: stderr))
}

/** What went wrong, in the words of `sshTrouble` in src/remote.ts. */
private func trouble(_ host: String, failed: String, detail: String, err: String) -> String {
	let banner = try! NSRegularExpression(pattern: "^#.*\\n?", options: .anchorsMatchLines)
	let kept = banner.stringByReplacingMatches(in: err, range: NSRange(err.startIndex..., in: err), withTemplate: "")
	let said = String(kept.trimmingCharacters(in: .whitespacesAndNewlines).suffix(500))
	let check = err.range(of: #"https://login\.tailscale\.com/\S+"#, options: .regularExpression).map { String(err[$0]) }
	if failed == "timeout" {
		if let check { return "Tailscale SSH wants you to confirm it is you before \(host) lets you in. Open \(check), sign in, then try again." }
		return "\(host) did not answer over SSH within a minute.\(said.isEmpty ? "" : " It said: \(said)")"
	}
	if failed == "garbage" { return "\(host) answered with something that is not pine's service line: \(detail)" }
	if detail == "127" { return "pine is not installed on \(host), or not on the PATH of its login shell. \(said)".trimmingCharacters(in: .whitespacesAndNewlines) }
	return said.isEmpty ? "SSH to \(host) ended (exit \(detail.isEmpty ? "unknown" : detail)) without saying why." : said
}
