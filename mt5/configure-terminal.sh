#!/bin/sh
# Enable algo trading + WebRequest and attach the AutotradeX Bridge EA on every terminal start.
# Usage (on the VPS): configure-terminal.sh <container> [chart-symbol]
set -eu
NAME="$1"; SYMBOL="${2:-EURUSD}"
VOLUME=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/home/mt5/wine"}}{{.Name}}{{end}}{{end}}' "$NAME")
[ -n "$VOLUME" ] || { echo "no wine volume on $NAME" >&2; exit 1; }
docker stop -t 20 "$NAME" >/dev/null
docker run --rm -v "$VOLUME:/home/mt5/wine" -e SYMBOL="$SYMBOL" --entrypoint sh autotradex-mt5:latest -c '
  set -eu
  C="/home/mt5/wine/drive_c/Program Files/MetaTrader 5/Config"
  # MT5 ini files are UTF-16LE with a BOM and CRLF line ends.
  to_utf8() { iconv -f UTF-16LE -t UTF-8 "$1" | sed "1s/^\xEF\xBB\xBF//" | tr -d "\r"; }
  to_utf16() { printf "\377\376"; sed "s/\$/\r/" | iconv -f UTF-8 -t UTF-16LE; }
  [ -f "$C/common.ini" ] && to_utf8 "$C/common.ini" > /tmp/common.ini || printf "[Common]\n" > /tmp/common.ini
  # Keep the encrypted WebRequestUrl of this terminal (set once through Options by allow-webrequest.sh).
  URL=$(awk "/^\[Experts\]/{e=1;next} /^\[/{e=0} e && /^WebRequestUrl=/" /tmp/common.ini)
  awk "/^\[Experts\]/{skip=1;next} /^\[/{skip=0} !skip" /tmp/common.ini > /tmp/common.clean
  { cat /tmp/common.clean
    printf "[Experts]\nAllowLiveTrading=1\nAllowDllImport=0\nEnabled=1\nAccount=0\nProfile=0\nWebRequest=1\n"
    [ -n "$URL" ] && printf "%s\n" "$URL"; true; } | to_utf16 > "$C/common.ini"
  # Startup config only attaches the EA; a startup [Experts] section would override the saved URL list.
  printf "[StartUp]\nExpert=AutotradeXBridge\nSymbol=%s\nPeriod=M1\n" "$SYMBOL" | to_utf16 > "$C/autotradex-startup.ini"
  rm -f "$C/autotradex-startup.applied.ini"
'
docker start "$NAME" >/dev/null
echo "$NAME configured: algo trading on, EA attached to $SYMBOL M1 on every start. Run allow-webrequest.sh $NAME once after login."
