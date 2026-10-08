#!/bin/sh
# Headless MT5: virtual display, loopback-only VNC for the one-time broker login, then keep the terminal running.
set -eu
MT5_DIR="$WINEPREFIX/drive_c/Program Files/MetaTrader 5"
# A container restart keeps /tmp; clear the previous display lock first.
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
sleep 1
openbox >/dev/null 2>&1 &
x11vnc -display :99 -forever -shared -rfbport 5900 -rfbauth /run/secrets/vnc_password -quiet >/dev/null 2>&1 &

if [ ! -f "$MT5_DIR/terminal64.exe" ]; then
  wineboot --init >/dev/null 2>&1 || true
  curl -fsSL -o /tmp/mt5setup.exe https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe
  wine /tmp/mt5setup.exe /auto >/dev/null 2>&1 || true
  # The installer starts the terminal itself; wait for the files, then stop it so the loop below owns it.
  for i in $(seq 1 120); do [ -f "$MT5_DIR/terminal64.exe" ] && break; sleep 2; done
  sleep 10; wineserver -k || true
fi

# Install/refresh the AutotradeX Bridge EA and recompile when the source changed.
EXPERTS="$MT5_DIR/MQL5/Experts"
if [ -f /bridge/AutotradeXBridge.mq5 ] && ! cmp -s /bridge/AutotradeXBridge.mq5 "$EXPERTS/AutotradeXBridge.mq5" 2>/dev/null; then
  mkdir -p "$EXPERTS" && cp /bridge/AutotradeXBridge.mq5 "$EXPERTS/"
  (cd "$MT5_DIR" && timeout 180 wine metaeditor64.exe /portable /compile:"MQL5\\Experts\\AutotradeXBridge.mq5" /log:"MQL5\\Experts\\AutotradeXBridge.log" >/dev/null 2>&1 || true)
fi

cd "$MT5_DIR"   # relative /config paths resolve against the working directory
# Docker stop: ask MT5 to close normally so it saves the session (auto-login) and chart profile.
stopping=0
graceful_stop() {
  stopping=1
  wine taskkill /IM terminal64.exe >/dev/null 2>&1 || true
  for i in $(seq 1 15); do pgrep -f terminal64.exe >/dev/null || break; sleep 1; done
  wineserver -k >/dev/null 2>&1 || true
  exit 0
}
trap graceful_stop TERM INT
# After an unclean stop MT5 may show its Login dialog with the saved credentials prefilled; confirm it.
( while true; do
    sleep 15
    W=$(xdotool search --onlyvisible --name '^Login$' 2>/dev/null | head -1)
    [ -n "$W" ] && xdotool windowactivate --sync "$W" key Return >/dev/null 2>&1
  done ) &
while [ "$stopping" = 0 ]; do
  # The startup config attaches the bridge EA on every launch. MT5 does not save startup charts
  # into the profile, so this neither duplicates charts nor depends on the profile surviving.
  CONFIG=""
  [ -f "$MT5_DIR/Config/autotradex-startup.ini" ] && CONFIG="/config:Config\\autotradex-startup.ini"
  wine "$MT5_DIR/terminal64.exe" /portable $CONFIG >/dev/null 2>&1 &
  wait $! || true
  sleep 5
done
