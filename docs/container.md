# The lab in a container

`Dockerfile` builds one image with the runner, the server and a browser
(Debian's Chromium, with fonts for Latin, CJK and emoji text). Nothing else
needs installing where it runs.

```bash
docker build -t surea11y-lab .
```

## Running a spec

Anything after the image name is the runner's command line
(`docs/scheduled-scans-guide.md`). It runs in `/work`, so mount the folder
holding your specs there; runs are kept in its `a11y-runs/`, as on a
workstation, and `--baseline auto` finds the last one.

```bash
docker run --rm -v "$PWD:/work" surea11y-lab specs/checkout.json --baseline auto
docker run --rm -v "$PWD:/work" surea11y-lab specs/products.batch.json --baseline auto --keep 14
docker run --rm -v "$PWD:/work" surea11y-lab specs/checkout.json --check
```

The exit code is the runner's: 0 nothing new, 3 new failures, 4 a degraded
run, and so on. A secret a spec reads from the environment (`{"$env": "NAME"}`)
is passed in with `-e`:

```bash
docker run --rm -e SHOP_PASSWORD -v "$PWD:/work" surea11y-lab specs/checkout.json
```

The container runs as the image's `node` user. When the mounted folder's owner
differs, run as yours so the files it writes are yours: `-u "$(id -u):$(id -g)"`.

To scan a site served on the machine itself (`http://localhost:…`), add
`--network host` (Linux), or use `host.docker.internal` as the host name.

## Running the app

```bash
docker run --rm -p 127.0.0.1:3000:3000 surea11y-lab server
```

Then open `http://127.0.0.1:3000`. The app's results and queue folders are in
`/lab/reports`; mount a volume there to keep them. Its HTTP API
(`docs/http-api.md`) is on the same port.

The server has no login and opens any page it is given. Inside the container
it listens on all interfaces, as it must to be reached through a published
port, so publish the port on `127.0.0.1` as above, or put it behind something
that authenticates. Reached by a name other than `localhost` or an IP address
(a proxy's, a Compose service's), the server refuses requests until that name
is in `A11Y_ALLOWED_HOSTS`: `-e A11Y_ALLOWED_HOSTS=lab.example.com`.

## Notes

- **Size.** About 1.9 GB, most of it the browser and its fonts.
- **Behind a proxy that inspects TLS**, the build needs the proxy's CA, which
  the image does not carry: build from a base that adds it, for example with
  `docker build --build-context node:24-bookworm-slim=docker-image://<your base> .`.
- **The image is not published** anywhere; build it from this repository.
