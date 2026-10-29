# Run the lab as a service

**For** platform teams who want other tools, or other teams, to start
accessibility runs and take their reports without installing anything.
**You get** a server that takes a workflow over HTTP and answers with its
report, in a container that brings its own browser.

## Steps

1. Run the lab's server, in its container:

   ```bash
   docker build -t surea11y-lab .
   docker run -d --name surea11y-lab -p 127.0.0.1:3000:3000 -v lab-reports:/lab/reports surea11y-lab server
   ```

   or with Compose: `examples/container/compose.yml`.
2. From any tool, post a workflow and take its report:

   ```bash
   node examples/integrations/run-over-http.js my.spec.json report.json --server http://127.0.0.1:3000
   ```

   It does what any client would: `POST /workflow-start` with the spec,
   `GET /workflow-progress` to follow it, and `GET /workflow-result` for the
   report.
3. For many runs, queue a batch: `POST /queue/items`, then `GET /queue` for
   its progress and the links to each result and to the whole batch as a zip.

[The HTTP API](../http-api.md) describes every call, and
`schemas/http-api.openapi.json` describes them as OpenAPI, for generating a
client.

## Keep it safe

The server has no login, and opens any page it is given. Keep it reachable
only by whom you trust: on the machine itself (`127.0.0.1`, as above), on a
private network, or behind a reverse proxy or gateway that authenticates.
Reached by a name of its own, the server needs that name in
`A11Y_ALLOWED_HOSTS`; a dashboard calling it from a browser needs its origin
in `A11Y_ALLOWED_ORIGINS` ([configuration](../configuration.md)).
[SECURITY.md](../../SECURITY.md) says more.

## Variations

- Show the results in the lab's own app: a report on the server opens with
  `http://<server>/?report=/reports/...` ([how](../http-api.md#opening-reports-in-the-app-by-address)).
- Run the runner, not the server, from a scheduler or a pipeline: the same
  image takes the runner's command line (`docker run --rm -v "$PWD:/work"
  surea11y-lab spec.json`).

## See also

[In a container](../container.md) · [The HTTP API](../http-api.md)
