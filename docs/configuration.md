# Configuration

The lab works without configuration. What follows changes where it listens,
how it scans and what it keeps.

## Environment variables

Read by the server and the command-line runner alike.

| Variable | What it sets |
| --- | --- |
| `PORT`, `HOST` | Where the server listens (default `127.0.0.1:3000`). The server has no login: see [SECURITY.md](../SECURITY.md) before listening beyond this machine |
| `A11Y_ALLOWED_HOSTS` | Host names, besides `localhost`, IP addresses and `HOST`, the server answers to: the name a reverse proxy or your network gives it, comma-separated; `*` for any. A request by another name is refused, so that a web page cannot reach the server through a name it points at this machine |
| `A11Y_ALLOWED_ORIGINS` | Web pages, besides the lab's own and the browser extension, that may call the server from a browser, as origins (`https://dashboard.example.com`), comma-separated. Calls from other pages are refused; calls with no page behind them (curl, scripts) are not affected |
| `A11Y_STEALTH` | `1` gives the browser a desktop Chrome's fingerprint (no "Headless" in its user agent, matching client hints), for a site of your own whose bot filter refuses headless Chrome. Off by default: the browser says what it is |
| `PUPPETEER_EXECUTABLE_PATH` | The browser to scan with, instead of the one installed with the lab |
| `A11Y_TZ` | The time zone pages see while scanned (default: the machine's own). Set it, for instance `Europe/Madrid`, for results that don't change with where the run happens |
| `A11Y_ACCEPT_LANGUAGE` | The `Accept-Language` pages are asked for (default `en-US,en;q=0.8`) |
| `A11Y_ISOLATE_RUNS` | Each scan in a browser context of its own, for reproducible results (default on) |
| `A11Y_DISABLE_CACHE` | No browser cache while scanning, for reproducible results (default on) |
| `A11Y_PACKS` | More standard packs for surea11y to load, besides the `@surea11y/pack-*` packages the lab depends on: package names, or paths from the lab's folder, comma-separated ([Standards](#standards)) |
| `A11Y_CORE_HOOKS` | Which of surea11y's hooks run before a page's own scripts: `internals` (names and roles web components set through `ElementInternals`), `listener` (event listeners added from script, for the keyboard rules) and `liveRegion` (what live regions are given, for the rule about announcements that may be missed). Default all; `none`, or a comma-separated list |
| `HEAVY_NODE_THRESHOLD` | A page with more elements than this is skipped rather than scanned, and the report says so |
| `A11Y_REPORTS_ROOT` | Where reports, evidence and element pictures are written (default `reports/`) |
| `A11Y_QUEUE_DIR` | Where the queue keeps its batches, inside the reports folder (default `batches`) |
| `A11Y_QUEUE_METRICS` | Each batch writes `metrics.jsonl`, what the server and browser used as it ran (default on) |
| `A11Y_MAX_RUNS` | How many runs started from the app's Run workflow (or `POST /workflow-start`) go at once; the others wait their turn, and say so in their log (default `4`). The queue has its own setting |
| `A11Y_VALIDATE_CANONICAL` | Check every scan's result against the lab's result model; for development |
| `A11Y_DEBUG_MODE` | More logging on the server, and surea11y's own output kept in the report |
| `A11Y_ECHO_BROWSER_CONSOLE` | Copy the scanned page's console output to the server's (set to `1`) |
| `A11Y_DUMP_RESULT_JSON`, `A11Y_DUMP_DIR`, `A11Y_DUMP_LOG` | Write surea11y's raw result for every scan to `a11y-dumps/` (or the folder given), and log where |

Variables a workflow reads secrets from (`{"$env": "NAME"}`) are the
workflow's own: see [the runner's guide](scheduled-scans-guide.md#passwords).

## The engine

The lab scans with surea11y, [`@surea11y/core`](https://github.com/SureA11y/core),
its one engine. `a11y-engine.config.json`, in the working folder, can set
options for it (`{ "engineOptions": { "surea11y": { … } } }`) and turn on
the result model check (`"validateCanonical": true`). Its `engineId` names
the engine the lab runs, `surea11y` unless another engine's adapter has been
added ([CONTRIBUTING.md](../CONTRIBUTING.md#adding-an-engine)).

## Standards

Besides WCAG, which surea11y has built in, the lab knows the standards of
the packs installed with it: [EN 301 549](https://github.com/SureA11y/pack-en301549)'s,
`@surea11y/pack-en301549`, is a dependency. Every `@surea11y/pack-*` package
in the lab's `package.json`, and any named in `A11Y_PACKS`, is loaded at
start; one that does not load is left out. What the lab knows of each
standard comes from the pack, so a further standard needs its pack
installed, not code of the lab's own:

- its profiles are options of a scan step's **Profile** (EN 301 549's have
  always been there), and a scan against one names the standard's
  requirements in its findings: each finding shows them as pills beside
  WCAG's ("Sample Standard 3"), the criteria table and comparisons list them
  by the WCAG criterion they correspond to, a grouping of your own can name
  them, and the scan is counted under the WCAG criteria its requirements
  correspond to, as a WCAG scan would be. A comparison of reports checked
  against different standards says so, since their rows do not line up;
- with a core that has test procedures, its requirements are sections of
  **Review conformance** and of the **manual review checklist** for a report
  whose scans used one of its profiles, each with how to check it by hand
  and drafted from what the scans found; a requirement that restates a WCAG
  criterion is reviewed as that criterion. The answers are kept in the
  report with the rest of the review. The conformance report (VPAT) stays
  WCAG's and EN 301 549's.

`GET /api/standards` lists them ([the server's API](http-api.md#what-the-server-knows)).

## The command-line runner

Its options (`--store`, `--baseline`, `--keep`, `--format`, …) are in
[the runner's guide](scheduled-scans-guide.md#options), and
`node src/cli/run-workflow.js --help` prints them.

## Workflows saved in an older format

Workflows saved before profiles replaced WCAG levels (and a scan's single
timeout became two) no longer run; `--check` says which fields. The converter
updates them:

```bash
node src/cli/convert-config.js <file or folder>          # lists what it would change
node src/cli/convert-config.js <file or folder> --write  # changes them
```

Reports saved before open, merge and compare as they always did.
