#!/bin/sh
# Log an MT5 terminal in to its broker account without screen sharing. The password is read with echo
# off, handed to the terminal in a root-only temp file that is deleted immediately after typing.
# Usage (from your Mac):  ssh -t root@91.108.104.102 /opt/mt5/login.sh mt5-xm 382048770 "XMGlobal-MT5 13"
# DRYRUN=1 fills the dialog and cancels instead of submitting.
set -eu
C="$1"; LOGIN="$2"; SERVER="$3"
printf "MT5 trading (master) password for %s on %s: " "$LOGIN" "$SERVER"
stty -echo 2>/dev/null || true; read -r PASS; stty echo 2>/dev/null || true; echo
[ -n "$PASS" ] || { echo "No password entered."; exit 1; }
printf %s "$PASS" | docker exec -i "$C" sh -c 'umask 077; cat > /tmp/.mt5pw'
PASS=""
docker exec -e LOGIN="$LOGIN" -e SERVER="$SERVER" -e DRYRUN="${DRYRUN:-}" "$C" sh -c '
  export DISPLAY=:99
  cleanup() { rm -f /tmp/.mt5pw; }; trap cleanup EXIT
  W=$(xdotool search --onlyvisible --name " - .* - " | head -1)
  [ -n "$W" ] || { echo "MetaTrader window not found"; exit 1; }
  # File > Login to Trade Account (menu layout fixed by the 1280x800 virtual display).
  xdotool windowactivate --sync "$W"; xdotool key --window "$W" alt+f; sleep 1.5
  xdotool mousemove 86 401 click 1; sleep 2
  xdotool search --onlyvisible --name "^Login$" >/dev/null || { echo "Login dialog did not open"; exit 1; }
  # Keyboard only: Wine does not move focus on synthetic clicks. The dialog opens on the Login box;
  # Tab order is Login > Password > Save password > Server.
  D=$(xdotool search --onlyvisible --name "^Login$" | head -1); xdotool windowactivate --sync "$D"; sleep 0.5
  # Tabbing into a field selects its contents, so typing replaces them; Save password stays ticked.
  xdotool key ctrl+a; xdotool type --delay 30 "$LOGIN"
  xdotool key Tab; sleep 0.3; xdotool type --delay 30 --file /tmp/.mt5pw
  rm -f /tmp/.mt5pw
  xdotool key Tab Tab; sleep 0.3; xdotool type --delay 30 "$SERVER"; sleep 1.5
  if [ -n "$DRYRUN" ]; then import -window root /tmp/login-dryrun.png 2>/dev/null || true; xdotool windowactivate --sync "$D" key Escape; echo "Dry run: dialog filled, then cancelled."; exit 0; fi
  xdotool windowactivate --sync "$D"; xdotool mousemove 617 465 click 1; sleep 1
  xdotool search --onlyvisible --name "^Login$" >/dev/null 2>&1 && xdotool windowactivate --sync "$D" key Return
  echo "Submitted. Waiting for the broker..."
  cd "$WINEPREFIX/drive_c/Program Files/MetaTrader 5"
  for i in $(seq 1 20); do
    sleep 2
    R=$(iconv -f UTF-16LE -t UTF-8 "$(ls -t logs/*.log | head -1)" | grep -E "'"'"'$LOGIN'"'"': (authorized|authorization)" | tail -1)
    case "$R" in *"authorized on"*) echo "SUCCESS: ${R#*Network	}"; exit 0;; esac
  done
  echo "Broker response: ${R#*Network	}"; exit 2
'
