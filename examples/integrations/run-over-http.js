#!/usr/bin/env node
'use strict';

/**
 * Runs a spec on a lab server over its HTTP API (docs/http-api.md), and saves
 * the report: what a tool does that uses the lab as a service rather than on
 * its own machine.
 *
 *   node examples/integrations/run-over-http.js <spec.json> [report.json] [--server http://127.0.0.1:3000]
 *
 * Needs Node 18 or later (fetch), and a lab server: npm start, or the
 * container's `server` mode.
 */

const fs = require('fs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runOverHttp(spec, { server = 'http://127.0.0.1:3000', every = 2000, log = () => {} } = {}) {
    const start = await fetch(`${server}/workflow-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
    });
    const started = await start.json();
    if (!start.ok) throw new Error(`${started.error}: ${started.details}`);
    log(`Started ${started.runId}`);

    let since = 0;
    for (;;) {
        await sleep(every);
        const progress = await (await fetch(`${server}/workflow-progress?runId=${started.runId}&since=${since}`)).json();
        for (const entry of progress.logs || []) log(`  ${entry.message}`);
        since = progress.nextIndex;
        const result = await fetch(`${server}/workflow-result?runId=${started.runId}`);
        if (result.status === 202) continue;
        const body = await result.json();
        if (!body.payload) throw new Error(body.error ? body.error.details : `the run ended: ${body.status}`);
        return body;
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const i = args.indexOf('--server');
    const server = i >= 0 ? args.splice(i, 2)[1] : undefined;
    const [specFile, out = 'report.json'] = args;
    if (!specFile) {
        console.error('Usage: node examples/integrations/run-over-http.js <spec.json> [report.json] [--server http://127.0.0.1:3000]');
        process.exit(2);
    }
    runOverHttp(JSON.parse(fs.readFileSync(specFile, 'utf8')), { server, log: (line) => console.log(line) })
        .then(({ status, payload }) => {
            fs.writeFileSync(out, JSON.stringify(payload, null, 2));
            console.log(`${status}: ${payload.scans.length} scan(s), report in ${out}`);
        })
        .catch((err) => {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        });
}

module.exports = { runOverHttp };
