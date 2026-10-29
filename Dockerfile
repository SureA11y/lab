# The lab's runner and server, with a browser, in one image.
#
#   docker build -t surea11y-lab .
#
#   # Run a spec (or a batch spec, or a saved configuration) from the current folder;
#   # runs are kept in ./a11y-runs, as on a workstation:
#   docker run --rm -v "$PWD:/work" surea11y-lab specs/checkout.json --baseline auto
#
#   # The app and its HTTP API (docs/http-api.md) on port 3000. It has no
#   # login: publish it on this machine only, as here, or behind one.
#   docker run --rm -p 127.0.0.1:3000:3000 surea11y-lab server
#
# Secrets a spec reads from the environment ({"$env": "NAME"}) are passed with -e NAME.
# More engines than surea11y: docker build --build-arg ADDONS=more-engines .
# See docs/container.md.

# The report's minified assets, which `npm start` builds before the server
# starts, built with the dev dependencies that minify them; only the output
# goes on.
FROM node:24-bookworm-slim AS assets
WORKDIR /lab
ENV PUPPETEER_SKIP_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN node src/js/build-report-assets.cjs.js

FROM node:24-bookworm-slim

# Shown by GitHub's container registry: the repository the image comes from,
# its licence and what it is.
LABEL org.opencontainers.image.source="https://github.com/SureA11y/lab" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.description="surea11y-lab: accessibility workflows, scans and comparisons, as an app, an HTTP API and a runner"

# Debian's Chromium, and the fonts a page is likely to ask for: the scans and
# screenshots read text as the browser renders it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        fonts-liberation fonts-dejavu-core fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
        git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /lab

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .
COPY --from=assets /lab/src/report/ /lab/src/report/

# Add-ons to install, space-separated: --build-arg ADDONS=more-engines adds
# the other engines (addons/more-engines). None by default: surea11y alone.
ARG ADDONS=""
RUN for addon in $ADDONS; do npm --prefix "addons/$addon" ci --omit=dev --no-audit --no-fund || exit 1; done

RUN chmod +x docker/entrypoint.sh \
    && mkdir -p /work /lab/reports \
    && chown -R node:node /work /lab/reports

USER node
WORKDIR /work
EXPOSE 3000

ENTRYPOINT ["/lab/docker/entrypoint.sh"]
CMD ["--help"]
