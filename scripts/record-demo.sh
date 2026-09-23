#!/bin/sh
# Record the published package's short interview and the files it writes.
# Run after publication: sh scripts/record-demo.sh [version] [output.gif]
# Defaults: package.json version, docs/demo.gif. Requires Node/npm, Python 3,
# asciinema 3 and agg. The package fetch is the only network step.
# Work, npm cache and the recording stay in .test-work/ until cleanup. An
# unsuccessful interview or render leaves an existing output GIF unchanged.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "$#" -gt 2 ]; then
  printf '%s\n' 'Usage: sh scripts/record-demo.sh [version] [output.gif]' >&2
  exit 2
fi
for tool in node npx python3 asciinema agg; do
  command -v "$tool" >/dev/null 2>&1 || { printf 'Missing command: %s\n' "$tool" >&2; exit 2; }
done
VERSION=${1:-$(node -p 'require(process.argv[1]).version' "$ROOT/package.json")}
node -e 'if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(process.argv[1])) process.exit(2)' "$VERSION" || {
  printf 'Expected an exact npm version, received: %s\n' "$VERSION" >&2
  exit 2
}
OUTPUT=${2:-"$ROOT/docs/demo.gif"}
case "$OUTPUT" in /*) ;; *) OUTPUT="$PWD/$OUTPUT" ;; esac
mkdir -p "$ROOT/.test-work"
AP_DEMO_WORK=$(mktemp -d "$ROOT/.test-work/demo.XXXXXX")
trap 'rm -rf "$AP_DEMO_WORK"' EXIT
trap 'exit 130' HUP INT TERM
AP_DEMO_PACKAGE="agent-personalizer@$VERSION"
export AP_DEMO_WORK AP_DEMO_PACKAGE
export npm_config_cache="$AP_DEMO_WORK/npm-cache"
export npm_config_update_notifier=false
export npm_config_audit=false
export npm_config_fund=false
mkdir "$AP_DEMO_WORK/project"

# Fetch once before capturing. This also proves the exact version is available.
printf 'Fetching %s for the recording...\n' "$AP_DEMO_PACKAGE"
ACTUAL=$(cd "$AP_DEMO_WORK/project" && npx --yes "$AP_DEMO_PACKAGE" --version)
[ "$ACTUAL" = "$VERSION" ] || { printf 'Version mismatch: expected %s, received %s\n' "$VERSION" "$ACTUAL" >&2; exit 2; }

cat > "$AP_DEMO_WORK/session.py" <<'PY'
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios
import time

package, project = sys.argv[1:]
command = ["npx", "--offline", "--yes", package]
# Each response waits for its real prompt. A changed interview fails the script
# rather than producing a plausible-looking recording of canned output.
answers = [
    ("Folder to install into [.]", "."),
    ("AIs [claude,agents]", "claude,agents"),
    ("Level [1]", "1"),
    ("What should the AI call you? [the user]", "Riley"),
    ("How direct should the AI be? [direct]", "direct"),
    ("How long should replies be? [short]", "short"),
    ("Where do your notes live? [folder]", "folder"),
    ("name (Notion, Google Docs, Apple Notes, others) [notes]", "notes"),
    ("How freely may the AI write into your notes? [notes-freely]", "notes-freely"),
    ("blank for all) [delete, publish, send, spend, settings, standing-rules]", ""),
]
print("$ " + " ".join(command), flush=True)
time.sleep(0.8)
pid, master = pty.fork()
if pid == 0:
    os.chdir(project)
    os.environ["TERM"] = "xterm-256color"
    os.execvp(command[0], command)
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 110, 0, 0))
next_answer = 0
pending = b""
deadline = time.monotonic() + 60
status = None
try:
    while True:
        if time.monotonic() > deadline:
            raise RuntimeError("interview timed out; inspect the published prompts")
        ready, _, _ = select.select([master], [], [], 0.1)
        if ready:
            try:
                chunk = os.read(master, 65536)
            except OSError as exc:
                if exc.errno != errno.EIO:
                    raise
                chunk = b""
            if not chunk:
                break
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()
            pending += chunk
            if next_answer < len(answers):
                prompt, answer = answers[next_answer]
                token = (prompt + ": ").encode()
                if token in pending:
                    time.sleep(0.6)
                    for character in answer:
                        os.write(master, character.encode())
                        time.sleep(0.04)
                    os.write(master, b"\n")
                    next_answer += 1
                    pending = b""
                    deadline = time.monotonic() + 60
        if status is None:
            finished, child_status = os.waitpid(pid, os.WNOHANG)
            if finished:
                status = child_status
                # Read final output buffered by the PTY before it closes.
    if status is None:
        _, status = os.waitpid(pid, 0)
    code = os.waitstatus_to_exitcode(status)
    if code != 0:
        raise RuntimeError(f"installer exited {code}")
    if next_answer != len(answers):
        raise RuntimeError("installer ended before every interview answer was used")
finally:
    os.close(master)
    if status is None:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)

# Show the actual directory, including the saved answers file.
time.sleep(1.2)
print("\n$ ls -1A", flush=True)
time.sleep(0.6)
import subprocess
subprocess.run(["ls", "-1A"], cwd=project, check=True)
time.sleep(2)
PY

asciinema record --headless --return --output-format asciicast-v2 \
  --window-size 110x32 --idle-time-limit 2 \
  --title "agent-personalizer $VERSION: interview and generated files" \
  --command 'python3 "$AP_DEMO_WORK/session.py" "$AP_DEMO_PACKAGE" "$AP_DEMO_WORK/project"' \
  "$AP_DEMO_WORK/demo.cast"
agg --theme github-dark --font-size 16 --idle-time-limit 2 \
  --last-frame-duration 4 "$AP_DEMO_WORK/demo.cast" "$AP_DEMO_WORK/demo.gif"
mkdir -p "$(dirname -- "$OUTPUT")"
cp "$AP_DEMO_WORK/demo.gif" "$OUTPUT"
printf 'Recorded %s to %s\n' "$AP_DEMO_PACKAGE" "$OUTPUT"
