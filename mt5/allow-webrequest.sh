#!/bin/sh
# One-time: add https://autotradex.io to MT5's WebRequest allow-list through Tools > Options > Expert Advisors.
# MT5 stores the list encrypted per installation, so it cannot be written to the ini directly.
# Usage (on the VPS, terminal logged in and idle): allow-webrequest.sh <container>
set -eu
docker exec "$1" sh -c '
  export DISPLAY=:99
  W=$(xdotool search --onlyvisible --name " - .* - " | head -1)
  [ -n "$W" ] || { echo "terminal window not found (not logged in?)" >&2; exit 1; }
  xdotool windowactivate --sync "$W" key ctrl+o; sleep 3
  O=$(xdotool search --onlyvisible --name "^Options$" | head -1)
  [ -n "$O" ] || { echo "Options dialog did not open" >&2; exit 1; }
  # The 1280x800 virtual screen centres the dialog: Experts tab, URL list, OK.
  xdotool mousemove 510 289 click 1; sleep 2
  xdotool mousemove 500 510 click --repeat 2 --delay 150 1; sleep 1
  xdotool type --delay 40 https://autotradex.io; xdotool key Return; sleep 1
  xdotool mousemove 755 644 click 1; sleep 2
'
# Restart so MT5 writes the setting to disk (graceful stop) and the EA starts with it.
docker restart -t 30 "$1" >/dev/null
echo "$1: WebRequest allowed for https://autotradex.io"
