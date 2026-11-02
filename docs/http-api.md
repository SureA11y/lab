# The lab's HTTP API

The app talks to its server over a small HTTP API, and anything else can use
the same calls: a script, a CI job, another internal tool. Start a run, follow
it, take its report; or queue a batch and download its results. There is no
logic here the app does not use: every run goes through the same
`executeWorkflowRun` as the Run button and the command line.

`schemas/http-api.openapi.json` describes the same calls as OpenAPI 3.1, with
the run spec and report schemas as their request and response types.

> **No login.** The server assumes whoever can reach it may use it: it opens
> any http or https URL it is given. It listens on 127.0.0.1 unless `HOST`
> says otherwise. Publish it only on the machine you work on, or behind
> something that authenticates (a reverse proxy, a VPN). The container image
> (`docs/container.md`) listens on all of its own interfaces, so publish its
> port as `-p 127.0.0.1:3000:3000`.
>
> **Browsers.** A call from a script or a tool works as below. A call from a
> web page other than the lab's own is refused unless its origin is in
> `A11Y_ALLOWED_ORIGINS`, and a call to a host name other than `localhost`
> or an IP address unless that name is in `A11Y_ALLOWED_HOSTS`
> ([SECURITY.md](../SECURITY.md)).

## One run

```bash
# 1. Start it. The body is a run spec (schemas/run-spec.v1.schema.json);
#    type and specVersion may be left out.
curl -s -X POST localhost:3000/workflow-start -H 'content-type: application/json' \
  -d '{"url":"https://example.com/","actions":[{"type":"a11yScan","label":"Home","profile":"wcag22-aa"}]}'
# {"ok":true,"runId":"run_k27mle37"}

# 2. Follow it (optional): the log from index `since` on.
curl -s 'localhost:3000/workflow-progress?runId=run_k27mle37&since=0'
# {"status":"running","nextIndex":12,"logs":[{ "time", "type", "message", "depth", ... }]}

# 3. Take the result: 202 while it runs, 200 once it has finished.
curl -s 'localhost:3000/workflow-result?runId=run_k27mle37'
# {"status":"done","payload":{ ...a report, schemas/report.v4.schema.json... }}
```

| Call | What it does |
| --- | --- |
| `POST /workflow-start` | Starts a run. Body: a run spec's fields (`url`, `actions`, and optionally `customSteps`, `scenarioName`, `viewport`, `colorScheme`, `highContrast`, `language`, `acceptUntrustedCerts`, `vars`; each scan step sets its own `profile`, `context` and `exclude`), plus `dryRun: true` for a dry run. Answers `{ ok, runId }`, with `warnings` when its check found something worth saying (an unknown field, ignored). A run that cannot work as asked is refused, before a browser opens, with 400 and `{ error, details, problems }`, `problems` every reason: the check `run-workflow.js --check` makes (the url, the run's fields, every step, each scan's profile and its Include and Exclude selectors, a navigate step's address), a secret not set in the server's environment, or `context` or `exclude` given to the run, which are each scan step's. At most `A11Y_MAX_RUNS` runs (4) go at once: one started past them waits its turn, `running` all the while, and its log says it is waiting. At most `A11Y_MAX_WAITING` (50) wait: past them the answer is 429, with `Retry-After`. |
| `GET /workflow-progress?runId=&since=` | The run's log from index `since`: `{ status, nextIndex, logs }`. Pass `nextIndex` back as `since`. |
| `GET /workflow-result?runId=` | 202 `{ status }` while it runs. Then `{ status, payload }`: `status` is `done`, `cancelled` or `error` (with `error`, `{ error, details, actionPath? }`, saying why), and `payload` the report, which names its page pictures by the links the server serves them at (`/reports/runs/<runId>/images/…`). A run that could not start has `{ status: "error", error: { error, details } }` and no payload; `details` says why (a step that cannot run, a secret not set in the server's environment). A dry run's result also has `dryRun`, the summary `run-workflow.js --dry-run` prints. |
| `POST /workflow-cancel` | Body `{ runId }`. The run stops at its next step and its result holds what it got so far; one still waiting its turn ends at once, with no payload. A run that has ended is left as it is; the answer gives its status. |

Every error is JSON, `{ error, details? }`: a body that is not JSON is 400, one over 200 MB 413. `POST /workflow-scan`, a synchronous scan outside the run limit, is gone: it answers 410.

Runs are kept in memory, not on disk: take the result before the server
restarts. A step that reads a secret from the environment (`{"$env": "NAME"}`)
reads the server's.

## A batch

The queue runs one batch at a time, each run through the same path, and keeps
every result on disk under `reports/batches/<start time>/`, with `batch.json`.

| Call | What it does |
| --- | --- |
| `POST /queue/items` | Queues a batch: `{ name, items: [{ run, row?, config? }] }`, each `run` a run spec's fields as for `/workflow-start`. 409 while another batch runs. |
| `GET /queue` | The queue: `{ concurrency, maxConcurrency, hold, resources, sessions }`; each session (a batch) in summary: its `counts` by status, `stats`, `scans`, its `slowest` run, whether it `hasResults`, the runs going now (`active`), the last to finish (`recent`), and links: `manifestUrl` (its `batch.json`), `zipUrl` (every result as a report package) and `itemsUrl`, where its runs are. |
| `GET /queue/sessions/{sessionId}/items?offset=&limit=&status=` | A batch's runs, a page at a time (100 unless `limit` says, at most 500), in the order they were queued, `status` keeping only those with the statuses given (comma-separated): `{ total, offset, limit, items }`, each with its `status`, figures, `fileUrl` and `zipUrl`. |
| `GET /queue/items/{itemId}/progress?since=` | A running item's log, as `/workflow-progress`. |
| `POST /queue/items/{itemId}/cancel`, `POST /queue/cancel` | Cancels one run, or the whole batch. |
| `POST /queue/settings` | `{ concurrency }`: how many runs at once. |
| `GET /queue/sessions/{sessionId}/masked-fields` | The secrets a batch's runs need typed (saved without them), and `POST /queue/sessions/{sessionId}/resume` with `{ values }` to supply them. A reference to the environment needs neither. |
| `GET /queue/sessions/{sessionId}/download.zip` | The batch as a report package: each result, its pictures once, `batch.json` and its configuration. |
| `GET /queue/sessions/{sessionId}/items/{itemId}/download.zip` | One run's report package. |
| `POST /queue/sessions/{sessionId}/delete` | Deletes a finished batch and its files. |

## Opening reports in the app by address

The app opens reports given in its address, so a link, a dashboard or another
tool can show one in it, or embed it in a frame:

| Address | Opens |
| --- | --- |
| `/?report=<url>` | The report at `<url>` in the open report tab: a report's JSON (`payload.json`, `*.a11y-report.json`), with its pictures from the `images/` folder beside it, or a report package's zip. |
| `/?compare=<url>&compare=<url>` | Those reports in the Compare tab, in that order; a downloaded comparison's zip, or a queue's, given once. |

`<url>` is fetched by the browser, so it must be one the page may read: on the
lab itself (`/reports/...`, where the queue keeps its batches), or a server
that allows it (CORS). A report that cannot be fetched or read says why in the
tab; the app is otherwise as it always opens.

## What the server knows

| Call | What it answers |
| --- | --- |
| `GET /health` | `{ status: "ok" }`. |
| `GET /workflows/actions` | The step definitions: what `schemas/run-spec.v1.schema.json` is generated from. |
| `GET /api/engine/capabilities` | What surea11y can check: its options and the profiles it supports. |
| `GET /api/engine/rules` | surea11y's rules catalog. |
| `GET /api/procedures/list?standard=wcag&version=2.2&levels=A,AA` | A standard's procedures, as the testing guide reads them: `{ available, listing }`, `listing` being what core's `listProcedures` gives. `standard` is `wcag`, `best-practice` or an installed pack's key; `tools`, `automation` and `locale` narrow it as core does. |
| `GET /api/procedures/languages?standard=wcag&version=2.1` | The languages a standard's procedures can be read in, as core's `procedureLanguages` gives them, its own first: `{ available, languages: [{ locale, complete, missing }] }`, `missing` counting the texts shown in another language; `languages` is `null` for a standard or version core doesn't know, and `{ available: false }` comes from a core that doesn't say. |
| `GET /api/procedures/index` | What the testing guide has: each WCAG version's criteria and each installed standard's requirements by version, for links into it to land. |
| `GET /api/procedures/page?…` | The same, as one HTML page to keep (core's `renderProcedures`), downloaded. |
| `GET /api/standards` | The standards of the installed packs, besides WCAG: `{ standards: [{ key, name, package, versions, profiles: [{ id, label, version, wcagVersion }], listings }] }`, where `listings`, with a core that has test procedures, gives each version's requirements (`id`, `title`, `wcag` for one that restates a WCAG criterion) in the standard's groups ([Standards](configuration.md#standards)). |
| `GET /api/procedures?ids=1.4.13,2.4.3` | How to check each WCAG criterion by hand, from surea11y core's test procedures: `{ available, locale, procedures: { [id]: procedure } }`, in `&locale=` where the standard is all in it, else in the standard's own language (`locale` says which), from a core that says which languages it has; in `&locale=` where it has the text, from one that doesn't. With `&standard=en301549&version=V4.1.1`, an installed standard's own requirements (`4.2.1`, `12.1`, `5`). `{ available: false }` from a core without procedures, or for a standard with no pack installed. |

`GET /guide` opens the testing guide, with the choices in its address
(`?standard=en301549&version=V4.1.1&id=4.2.1`).

Everything else the server answers is the app's own (its page, the report
assets, the manual-scan flow) and may change with it.
