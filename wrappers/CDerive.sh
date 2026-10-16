#!/bin/sh
# C99 fold port (gitpp-c). Reads a JSON record array on stdin, writes the
# derive() result to a temp file, prints it.
BIN="${GITPP_C_BIN:-/tmp/gitpp-c-derive}"
TMP="$(mktemp -t cderive.XXXXXX.json)"
cat > "$TMP"
"$BIN" "$TMP" --derive
rm -f "$TMP"
