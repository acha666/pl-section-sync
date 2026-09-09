FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends chromium && rm -rf /var/lib/apt/lists/*
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
    XDG_CONFIG_HOME=/tmp/pl-config \
    XDG_CACHE_HOME=/tmp/pl-cache
WORKDIR /workspace
USER node
