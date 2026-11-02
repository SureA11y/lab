'use strict';

// The extension's surea11y adapter scanning against several profiles at
// once, as the panel asks when a WCAG level and a standard are both chosen:
// the real bundle in a jsdom page through runInTab, then canonicalize, as the
// panel does. A bundle whose core scans one profile at a time (before 1.15)
// skips these; so do the tests that need the packs' script, which
// build:extension-shared writes from the packs installed.

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

let SUREA11Y;
let targets;

before(() => {
    globalThis.A11Y_SCAN_NOTES = require('./scan-notes.js');
    targets = globalThis.A11Y_CONFORMANCE_TARGETS = require('./conformance-targets.js');
    require('./engines/a11y-extension-surea11y-engine.js');
    SUREA11Y = globalThis.A11Y_EXTENSION_A11Y_LABS_ENGINE;
});

const VENDOR = path.join(__dirname, 'engines', 'vendor');
const BUNDLE = fs.readFileSync(path.join(VENDOR, 'surea11y.browser.min.js'), 'utf8');
const PACKS = fs.existsSync(path.join(VENDOR, 'surea11y-packs.js')) ? fs.readFileSync(path.join(VENDOR, 'surea11y-packs.js'), 'utf8') : null;
const STANDARDS = fs.existsSync(path.join(VENDOR, 'standards.json')) ? JSON.parse(fs.readFileSync(path.join(VENDOR, 'standards.json'), 'utf8')) : null;

function pageWith(html, {packs = false} = {}) {
    const dom = new JSDOM(html, {runScripts: 'outside-only', url: 'https://example.test/'});
    dom.window.eval(BUNDLE);
    if (packs) dom.window.eval(PACKS);
    const execInTab = async (_tabId, details) => {
        const run = dom.window.eval(`(${details.func.toString()})`);
        return [await run(...details.args)];
    };
    return {execInTab};
}

const PAGE = '<!doctype html><html lang="en"><head><title>t</title></head><body><main>'
    + '<div role="grid"><div role="row"><span role="gridcell">Cell</span></div></div>'
    + '<div role="group" aria-checked="true">Group</div>'
    + '<img src="a.png"></main></body></html>';

const scan = async (profile, {packs = false} = {}) => {
    const {execInTab} = pageWith(PAGE, {packs});
    const selection = targets.resolveScanSelection({profile});
    const native = await SUREA11Y.runInTab(1, {
        selection,
        pageReadyTimeoutMs: 0,
        packs: packs && STANDARDS ? STANDARDS.packs : [],
    }, {execInTab});
    // Out of the page's realm, so its arrays compare as ours.
    const plain = JSON.parse(JSON.stringify(native));
    return {native: plain, canonical: JSON.parse(JSON.stringify(SUREA11Y.canonicalize(native, {runOptions: {engineOptions: {findingsSource: 'both'}}})))};
};

// Whether the bundle's core scans several profiles at once.
let several = null;
async function scansSeveral() {
    if (several === null) {
        const {native} = await scan(['wcag22-aa', 'en301549-v4.1.1']);
        several = !!(native.engine && Array.isArray(native.engine.profiles));
    }
    return several;
}

describe('extension surea11y adapter: several profiles at once', () => {
    test('a WCAG level and EN 301 549: both ran, and each requirement is listed', async (t) => {
        if (!(await scansSeveral())) return t.skip('this bundle\'s core scans one profile at a time');
        const {native, canonical} = await scan(['wcag22-aaa', 'en301549-v4.1.1']);
        assert.deepEqual(native.engine.profiles, ['wcag22-aaa', 'en301549-v4.1.1']);
        assert.deepEqual(canonical.runOptions.conformanceProfiles.map((p) => p.id), ['wcag22-aaa', 'en301549-v4.1.1']);
        assert.equal('profilesNotRun' in canonical.runOptions, false);
        // EN 301 549 built into core judges by WCAG's criteria (its own
        // clauses come with its pack): the rollup says both gave it.
        const text = canonical.findings.find((f) => f.ruleId === 'wcag-1.1.1-non-text-content' && f.outcome === 'fail');
        assert.deepEqual(text.evidence.rollup.profiles, ['wcag22-aaa', 'en301549-v4.1.1']);
        // No fallback scan: a list names each profile that did not run instead.
        assert.equal(native.profileUnavailable, null);
    });

    test('a profile core has not got is named, and the others still run', async (t) => {
        if (!(await scansSeveral())) return t.skip('this bundle\'s core scans one profile at a time');
        const {canonical} = await scan(['wcag22-aa', 'nope-1.0']);
        // An unknown id is no target: the selection drops it, so it is one profile.
        assert.equal('conformanceProfiles' in canonical.runOptions, false);

        targets.registerStandardProfiles([{profiles: [{id: 'demo-1.0', label: 'Demo 1.0'}]}]);
        const {canonical: demo} = await scan(['wcag22-aa', 'demo-1.0']);
        assert.deepEqual(demo.runOptions.profilesNotRun.map((p) => [p.id, p.label]), [['demo-1.0', 'Demo 1.0']]);
        const notice = demo.notices.find((n) => n.code === 'profile-not-run');
        assert.equal(notice.profile, 'demo-1.0');
    });

    test('with the packs: WAI-ARIA fails what WCAG asks about, each rollup reading its own verdict', async (t) => {
        if (!(await scansSeveral())) return t.skip('this bundle\'s core scans one profile at a time');
        const aria = STANDARDS && STANDARDS.standards.find((s) => s.key === 'wai-aria');
        if (!PACKS || !aria) return t.skip('built without the WAI-ARIA pack');
        targets.registerStandardProfiles(STANDARDS.standards);
        const {canonical} = await scan(['wcag22-aa', 'wai-aria-1.2'], {packs: true});
        assert.deepEqual(canonical.runOptions.conformanceProfiles.map((p) => p.id), ['wcag22-aa', 'wai-aria-1.2']);

        const of = (id) => canonical.findings.filter((f) => f.ruleId === id && (f.outcome === 'fail' || f.outcome === 'cantTell'));
        const [wcag] = of('wcag-4.1.2-aria-validity');
        const [ariaAttrs] = of('wai-aria-1.2-supported-attributes');
        assert.equal(wcag.outcome, 'cantTell');
        assert.deepEqual(wcag.occurrences.map((o) => o.occurrenceOutcome), ['cantTell'], 'WCAG keeps asking');
        assert.equal(ariaAttrs.outcome, 'fail');
        assert.deepEqual(ariaAttrs.occurrences.map((o) => o.occurrenceOutcome), ['fail']);

        const rule = canonical.findings.find((f) => f.ruleId === 'aria-allowed-attr');
        assert.deepEqual(rule.verdicts, {'wcag22-aa': 'cantTell', 'wai-aria-1.2': 'fail'});
        assert.equal(rule.checkOutcome, 'cantTell');
    });
});
