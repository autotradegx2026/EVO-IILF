# Headless MetaTrader 5 terminal (Wine + Xvfb) with a loopback-only VNC for one-time broker login.
FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN dpkg --add-architecture i386 && apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg xvfb x11vnc openbox xdotool procps \
 && install -d -m 755 /etc/apt/keyrings \
 && curl -fsSL https://dl.winehq.org/wine-builds/winehq.key | gpg --dearmor -o /etc/apt/keyrings/winehq.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/winehq.gpg] https://dl.winehq.org/wine-builds/debian/ bookworm main" > /etc/apt/sources.list.d/winehq.list \
 && apt-get update \
 # Pin Wine 10.0: 10.3+ trips MetaTrader's anti-debugger check (WineHQ bug 57950/58043).
 && V=10.0.0.0~bookworm-1 && apt-get install -y --install-recommends winehq-stable=$V wine-stable=$V wine-stable-amd64=$V wine-stable-i386=$V \
 && apt-mark hold winehq-stable wine-stable wine-stable-amd64 wine-stable-i386 \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 mt5 && install -d -o mt5 -g mt5 /home/mt5/wine && install -d -m 1777 /tmp/.X11-unix
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh
USER mt5
ENV WINEPREFIX=/home/mt5/wine WINEDEBUG=-all DISPLAY=:99 WINEDLLOVERRIDES="mscoree,mshtml="
VOLUME /home/mt5/wine
CMD ["/usr/local/bin/entrypoint.sh"]
