'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    EXIT,
    loadBaselinePayload,
    summarizeDiff,
    compareToBaseline,
    decideExit,
} = require('./baseline');

let tmpDir;

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-baseline-'));
});

after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function finding(ruleId, severity, targets) {
    return {
        ruleId,
        id: ruleId,
        title: `${ruleId} title`,
        severity,
        outcome: 'fail',
        wcag: { sc: [{ ref: '1.4.3', level: 'AA' }] },
        occurrences: targets.map((t) => ({ pageUrl: 'https://example.com/', target: [t] })),
    };
}

function payload(runId, timestamp, findings) {
    return {
        runId,
        timestamp,
        url: 'https://example.com/',
        scenarioName: 'Checkout',
        scans: [{ id: 's1', url: 'https://example.com/', canonical: { findings } }],
        metrics: { a11ySummary: { scores: { avgPageAccessibility: 70, confidence: 90 } } },
    };
}

const BASELINE = payload('run_a', '2026-01-01T00:00:00Z', [
    finding('color-contrast', 'serious', ['#a', '#b']),
    finding('image-alt', 'serious', ['#img']),
]);

const CURRENT = payload('run_b', '2026-02-01T00:00:00Z', [
    finding('color-contrast', 'serious', ['#a']),
    finding('label', 'critical', ['#field']),
]);

function writeFixture(name, value) {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
    return filePath;
}

describe('loadBaselinePayload', () => {
    test('reads a payload file', () => {
        const filePath = writeFixture('baseline.json', BASELINE);
        const result = loadBaselinePayload(filePath);

        assert.equal(result.ok, true);
        assert.equal(result.payload.runId, 'run_a');
        assert.equal(result.filePath, filePath);
    });

    test('reads payload.json out of a run directory', () => {
        const dir = path.join(tmpDir, 'previous-run');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'payload.json'), JSON.stringify(BASELINE), 'utf8');

        const result = loadBaselinePayload(dir);

        assert.equal(result.ok, true);
        assert.equal(result.payload.runId, 'run_a');
        assert.equal(result.filePath, path.join(dir, 'payload.json'));
    });

    test('reports a path that is not there', () => {
        const result = loadBaselinePayload(path.join(tmpDir, 'nope.json'));

        assert.equal(result.ok, false);
        assert.match(result.error, /cannot read baseline/);
    });

    test('reports a directory with no payload in it', () => {
        const dir = path.join(tmpDir, 'empty-run');
        fs.mkdirSync(dir, { recursive: true });

        const result = loadBaselinePayload(dir);

        assert.equal(result.ok, false);
        assert.match(result.error, /cannot read baseline/);
    });

    test('reports a file that is not a run payload', () => {
        assert.match(loadBaselinePayload(writeFixture('broken.json', '{oops')).error, /cannot read baseline/);
        assert.match(loadBaselinePayload(writeFixture('spec.json', { type: 'a11y-run-spec' })).error, /not a run payload/);
        assert.match(loadBaselinePayload(writeFixture('list.json', [1, 2])).error, /not a run payload/);
    });
});

describe('compareToBaseline', () => {
    test('counts rules and the instances behind them', () => {
        const { summary } = compareToBaseline(BASELINE, CURRENT);

        assert.deepEqual(summary.rules, { new: 1, resolved: 1, persistent: 1 });
        assert.deepEqual(summary.occurrences, { new: 1, fixed: 2, still: 1 });
        assert.equal(summary.net, -1);
        assert.equal(summary.headline, 'improved');
    });

    test('names the rules that appeared', () => {
        const { summary } = compareToBaseline(BASELINE, CURRENT);

        assert.deepEqual(summary.newRules, [
            { ruleId: 'label', title: 'label title', severity: 'critical', occurrences: 1 },
        ]);
    });

    test('an unchanged run reports nothing new', () => {
        const { summary } = compareToBaseline(BASELINE, payload('run_c', '2026-02-01T00:00:00Z', [
            finding('color-contrast', 'serious', ['#a', '#b']),
            finding('image-alt', 'serious', ['#img']),
        ]));

        assert.deepEqual(summary.rules, { new: 0, resolved: 0, persistent: 2 });
        assert.deepEqual(summary.occurrences, { new: 0, fixed: 0, still: 3 });
        assert.equal(summary.net, 0);
    });

    test('a regression on an existing rule still counts as new instances', () => {
        const { summary } = compareToBaseline(BASELINE, payload('run_d', '2026-02-01T00:00:00Z', [
            finding('color-contrast', 'serious', ['#a', '#b', '#c']),
            finding('image-alt', 'serious', ['#img']),
        ]));

        assert.equal(summary.rules.new, 0);
        assert.equal(summary.occurrences.new, 1);
        assert.equal(summary.net, 1);
        assert.equal(summary.headline, 'regressed');
    });

    test('flags a baseline that is newer than the run it is compared with', () => {
        const older = payload('run_old', '2026-01-01T00:00:00Z', []);
        const newer = payload('run_new', '2026-03-01T00:00:00Z', []);

        assert.equal(compareToBaseline(older, newer).swapped, false);
        assert.equal(compareToBaseline(newer, older).swapped, true);
    });

    test('compares runs that carry no timestamp in the order given', () => {
        const a = { runId: 'a', url: 'https://example.com/', scans: [] };
        const b = { runId: 'b', url: 'https://example.com/', scans: [] };

        assert.equal(compareToBaseline(a, b).swapped, false);
    });
});

describe('summarizeDiff', () => {
    test('survives a diff with nothing in it', () => {
        const summary = summarizeDiff({});

        assert.deepEqual(summary.rules, { new: 0, resolved: 0, persistent: 0 });
        assert.deepEqual(summary.occurrences, { new: 0, fixed: 0, still: 0 });
        assert.deepEqual(summary.newRules, []);
        assert.equal(summary.net, 0);
        assert.equal(summary.headline, null);
    });
});

describe('decideExit', () => {
    const clean = { degraded: false };
    const degraded = { degraded: true };
    const withNew = { occurrences: { new: 2 } };
    const withoutNew = { occurrences: { new: 0 } };

    test('a finished run with nothing new passes', () => {
        assert.equal(decideExit({ status: 'done', health: clean, summary: withoutNew }), EXIT.OK);
        assert.equal(decideExit({ status: 'done', health: clean, summary: null }), EXIT.OK);
    });

    test('new instances fail', () => {
        assert.equal(decideExit({ status: 'done', health: clean, summary: withNew }), EXIT.NEW_INSTANCES);
    });

    test('a degraded run fails even when nothing new was found', () => {
        assert.equal(decideExit({ status: 'done', health: degraded, summary: withoutNew }), EXIT.DEGRADED);
    });

    test('degradation outranks a regression, because it makes the diff unsound', () => {
        assert.equal(decideExit({ status: 'done', health: degraded, summary: withNew }), EXIT.DEGRADED);
    });

    test('a failed or cancelled run outranks both', () => {
        assert.equal(decideExit({ status: 'error', health: degraded, summary: withNew }), EXIT.RUN_FAILED);
        assert.equal(decideExit({ status: 'cancelled', health: degraded, summary: withNew }), EXIT.CANCELLED);
    });

    test('decides without a health assessment or a summary', () => {
        assert.equal(decideExit({ status: 'done' }), EXIT.OK);
        assert.equal(decideExit({}), EXIT.OK);
    });

    test('--fail-on-lean: new likely failures fail, after new failing instances', () => {
        assert.equal(decideExit({ status: 'done', health: clean, summary: withoutNew, likely: { total: 3, known: 1, new: 2 } }), EXIT.LIKELY_FAILURES);
        assert.equal(decideExit({ status: 'done', health: clean, summary: withoutNew, likely: { total: 3, known: 3, new: 0 } }), EXIT.OK);
        assert.equal(decideExit({ status: 'done', health: clean, summary: withNew, likely: { total: 1, known: 0, new: 1 } }), EXIT.NEW_INSTANCES);
        assert.equal(decideExit({ status: 'done', health: degraded, summary: null, likely: { total: 1, known: 0, new: 1 } }), EXIT.DEGRADED);
    });
});

describe('decideExit --fail-on-failures', () => {
    const clean = { degraded: false };

    test('with no baseline, failing instances fail as new ones do', () => {
        assert.equal(decideExit({ status: 'done', health: clean, summary: null, failing: 8 }), EXIT.NEW_INSTANCES);
        assert.equal(decideExit({ status: 'done', health: clean, summary: null, failing: 0 }), EXIT.OK);
    });

    test('with a baseline, only new instances count, as without the flag', () => {
        assert.equal(decideExit({ status: 'done', health: clean, summary: { occurrences: { new: 0 } }, failing: 8 }), EXIT.OK);
    });

    test('a degraded or failed run still outranks it', () => {
        assert.equal(decideExit({ status: 'done', health: { degraded: true }, summary: null, failing: 8 }), EXIT.DEGRADED);
        assert.equal(decideExit({ status: 'error', health: clean, summary: null, failing: 8 }), EXIT.RUN_FAILED);
    });

    test('outranks new likely failures, as new failing instances do', () => {
        assert.equal(decideExit({ status: 'done', health: clean, summary: null, failing: 1, likely: { total: 2, known: 0, new: 2 } }), EXIT.NEW_INSTANCES);
    });
});

describe('compareToBaseline opt-in rules', () => {
    test('names the opt-in rules each side ran', () => {
        const base = payload('run_a', '2026-01-01T00:00:00Z', []);
        const current = payload('run_b', '2026-02-01T00:00:00Z', []);
        current.scans.forEach((s) => { s.optInRules = ['rgaa']; });
        assert.deepEqual(compareToBaseline(base, current).optInRules, { baseline: [], current: ['rgaa'] });
    });
});

describe('compareToBaseline engine releases', () => {
    const withEngine = (p, version) => ({
        ...p,
        scans: p.scans.map((s) => ({ ...s, canonical: { ...s.canonical, engines: [{ id: '@surea11y', name: 'surea11y', version }] } })),
    });

    test('names an engine whose release differs between the two', () => {
        const { engineChanges } = compareToBaseline(withEngine(BASELINE, '1.13.1'), withEngine(CURRENT, '1.14.0'));
        assert.deepEqual(engineChanges, [{ name: 'surea11y', versions: ['1.13.1', '1.14.0'] }]);
    });

    test('says nothing when both used the same release', () => {
        assert.deepEqual(compareToBaseline(withEngine(BASELINE, '1.14.0'), withEngine(CURRENT, '1.14.0')).engineChanges, []);
    });
});
