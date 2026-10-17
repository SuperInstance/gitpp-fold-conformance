#!/bin/sh
# C99 fold port (gitpp-c). Reads a JSON record array on stdin, writes the
# derive() result to a temp file, prints it.
# The workflow copies the built binary to $GITHUB_WORKSPACE/gitpp-c-derive
# and exports GITPP_C_BIN. The /tmp default is the legacy single-machine
# layout; a stale binary there would silently test the wrong build, so
# GITPP_C_BIN is the documented path and the fallback is only a fallback.
BIN="${GITPP_C_BIN:-/tmp/gitpp-c-derive}"
TMP="$(mktemp -t cderive.XXXXXX.json)"
cat > "$TMP"
"$BIN" "$TMP" --derive
rm -f "$TMP"
