// What the web bridge runs on the owner's machine over an exec channel: the command src/remote.ts
// builds for the Pine app (`remoteCommand()`), copied, since that file loads Node's own modules and
// the browser build cannot carry it. src/remote.test.ts fails when they differ.
// It prints `pine service`'s one line of JSON (where the daemon answers, its token), then holds
// the session with `cat`, so that a daemon it started lives as long as the channel.

const SCRIPT = [
	`p=$("\${SHELL:-/bin/sh}" -l -c "printenv PATH" </dev/null 2>/dev/null | tail -n 1)`,
	`[ -n "$p" ] || p=$("\${SHELL:-/bin/sh}" -c "printenv PATH" </dev/null 2>/dev/null | tail -n 1)`,
	`[ -n "$p" ] && PATH="$p" && export PATH`,
	`[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1`,
	`command -v pine >/dev/null || { echo "pine is not installed there: no pine command on its PATH." >&2; exit 127; }`,
	`pine service && exec cat >/dev/null`,
].join("; ");

export const REMOTE_COMMAND = `exec /bin/sh -c '${SCRIPT}'`;
