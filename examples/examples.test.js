'use strict';

// The examples stay runnable: every spec passes the checks a run makes
// before it starts and fits its published schema, the integration scripts
// read what the lab writes, and the demo shop serves both releases.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.DEMO_SHOP_PASSWORD = 'any';

const { checkSpec } = require('../src/cli/check-spec');
const { checkBatch, isBatch } = require('../src/cli/batch-spec');
const { checkAgainstSchema } = require('../src/shared/json-schema-check');
const { runSpecSchema, batchSpecSchema } = require('../src/server-side/step-check');
const { compareToBaseline, diffDocument } = require('../src/cli/baseline');
const { createWorkflowPayloadBuilder } = require('../src/shared/workflow-payload-builder');
const { findingsByOutcome } = require('../src/server-side/a11y-canonical');
const { newIssues, markdown } = require('./integrations/new-issues');
const { rows, toCsv } = require('./integrations/findings-to-csv');
const { locations, batchSpec } = require('./integrations/sitemap-to-batch');

const SPECS = path.join(__dirname, 'specs');
const specFiles = fs.readdirSync(SPECS).filter((f) => f.endsWith('.json'));

describe('the example specs', () => {
    test('there are some', () => assert.ok(specFiles.length >= 5));

    for (const file of specFiles) {
        test(`${file} can run, and fits its schema`, () => {
            const raw = JSON.parse(fs.readFileSync(path.join(SPECS, file), 'utf8'));
            const { errors, warnings } = isBatch(raw) ? checkBatch(raw) : checkSpec(raw);
            assert.deepEqual({ errors, warnings }, { errors: [], warnings: [] });
            const { $schema, ...doc } = raw;
            assert.deepEqual(checkAgainstSchema(isBatch(raw) ? batchSpecSchema() : runSpecSchema(), { $schema, ...doc }), []);
            assert.ok(/^\.\.\/\.\.\/schemas\/(run|batch)-spec\.v1\.schema\.json$/.test($schema), 'names its schema for editors');
        });
    }
});

// A run of the tour on each release, as the lab builds it, without a browser.
function run(runId, timestamp, origin, failures) {
    const builder = createWorkflowPayloadBuilder({
        METRIC_DEFS: {},
        sortByOrderKey: (arr) => arr,
        findingsByOutcome,
        getA11yGlobalFindings: () => [],
        buildGlobalSummary: () => ({ domMetrics: null, a11ySummary: null }),
    });
    const payload = builder.buildWorkflowPayloadBase({ url: `${origin}/`, runId, timestamp, scenarioName: 'Demo shop tour' });
    payload.scans.push({
        id: 'cart',
        label: 'Cart',
        url: `${origin}/cart.html`,
        profile: { id: 'wcag22-aa', label: 'WCAG 2.2 AA' },
        wcag: { version: '2.2', level: 'AA' },
        canonical: {
            findings: failures.map(([ruleId, title, target]) => ({
                id: ruleId, uid: `surea11y:fail:${ruleId}:${target}`, ruleId, title, severity: 'serious', outcome: 'fail',
                wcag: { sc: [{ ref: '4.1.2', level: 'A' }] },
                occurrences: [{ pageUrl: `${origin}/cart.html`, target: [target] }],
            })),
        },
    });
    return JSON.parse(JSON.stringify(builder.finalizeWorkflowPayload(payload)));
}

describe('the integration scripts', () => {
    const release1 = run('r1', '2026-03-01T10:00:00Z', 'http://localhost:8780', [['wcag-1.4.3-contrast', 'Contrast: minimum', 'a.checkout']]);
    const release2 = run('r2', '2026-03-08T10:00:00Z', 'http://localhost:8781', [
        ['wcag-1.4.3-contrast', 'Contrast: minimum', 'a.checkout'],
        ['wcag-4.1.2-name', 'Name, role, value: accessible name', 'p > button'],
    ]);
    const diff = JSON.parse(JSON.stringify(diffDocument(compareToBaseline(release1, release2))));

    test('new-issues files one issue per new failure, by the id it keeps', () => {
        const issues = newIssues(diff);
        assert.equal(issues.length, 1);
        assert.equal(issues[0].element, 'p > button');
        assert.equal(issues[0].id, release2.scans[0].canonical.findings[1].occurrences[0].occurrenceId);
        assert.match(markdown(issues, diff), /## Name, role, value: accessible name: p > button/);
    });

    test('new-issues says so when nothing is new', () => {
        const same = JSON.parse(JSON.stringify(diffDocument(compareToBaseline(release1, release1))));
        assert.deepEqual(newIssues(same), []);
        assert.match(markdown([], same), /^No new failures/);
    });

    test('new-issues --fixed gives the failures to close', () => {
        // A third release, a week later, fixes the button again.
        const release3 = run('r3', '2026-03-15T10:00:00Z', 'http://localhost:8781', [['wcag-1.4.3-contrast', 'Contrast: minimum', 'a.checkout']]);
        const back = JSON.parse(JSON.stringify(diffDocument(compareToBaseline(release2, release3))));
        const closed = newIssues(back, { tag: 'fixed' });
        assert.deepEqual(closed.map((i) => i.element), ['p > button']);
        assert.match(markdown([], back, { tag: 'fixed' }), /^Nothing the baseline had is fixed/);
    });

    test('sitemap-to-batch makes a batch spec the runner accepts', () => {
        const xml = fs.readFileSync(path.join(__dirname, 'demo-site', 'sitemap.xml'), 'utf8');
        const urls = locations(xml);
        assert.equal(urls.length, 6);
        const workflow = JSON.parse(fs.readFileSync(path.join(SPECS, 'home.spec.json'), 'utf8'));
        const batch = batchSpec(urls.filter((u) => u.includes('product-')), workflow);
        assert.deepEqual(batch.rows.map((r) => r.name), ['product-shoes.html', 'product-bag.html']);
        const { errors, warnings } = checkBatch(batch);
        assert.deepEqual({ errors, warnings }, { errors: [], warnings: [] });
        assert.deepEqual(checkAgainstSchema(batchSpecSchema(), batch), []);
    });

    test('findings-to-csv gives a row per element, quoting what needs it', () => {
        const csv = toCsv(rows(release2));
        const lines = csv.trim().split('\n');
        assert.equal(lines[0], 'run,timestamp,scan,profile,page,rule,title,severity,wcag,element,occurrenceId');
        assert.equal(lines.length, 3);
        assert.match(lines[2], /"Name, role, value: accessible name"/);
    });
});

describe('the demo shop', () => {
    let servers;
    const port = 18780;
    before(() => {
        process.env.PORT = String(port);
        servers = require('./serve-demo-site');
        delete require.cache[require.resolve('./serve-demo-site')];
    });
    after(() => {
        servers.release1.close();
        servers.release2.close();
    });

    const get = async (url) => {
        const res = await fetch(url);
        return { status: res.status, text: await res.text() };
    };

    test('serves release 1, and release 2 beside it at the same paths', async () => {
        assert.match((await get(`http://localhost:${port}/`)).text, /Click here/);
        const v2 = await get(`http://localhost:${port + 1}/`);
        assert.match(v2.text, /release 2/);
        assert.doesNotMatch(v2.text, /Click here/);
        assert.equal((await get(`http://localhost:${port + 1}/style.css`)).status, 200);
    });

    test('serves nothing outside the shop', async () => {
        assert.equal((await get(`http://localhost:${port}/..%2F..%2Fpackage.json`)).status, 404);
        assert.equal((await get(`http://localhost:${port}/missing.html`)).status, 404);
    });
});
