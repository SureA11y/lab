'use strict';

// The extension's surea11y adapter reads the same notes, margins and details
// from a result as the lab's server adapter does (shared/scan-notes.js, copied
// here). These run the real bundle in a jsdom page through runInTab, then
// canonicalize what it returned, as the panel does. node's test runner
// isolates each file in its own process.

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

let SUREA11Y;

before(() => {
    globalThis.A11Y_SCAN_NOTES = require('./scan-notes.js');
    globalThis.A11Y_CONFORMANCE_TARGETS = require('./conformance-targets.js');
    require('./engines/a11y-extension-surea11y-engine.js');
    SUREA11Y = globalThis.A11Y_EXTENSION_A11Y_LABS_ENGINE;
});

const BUNDLE = fs.readFileSync(path.join(__dirname, 'engines', 'vendor', 'surea11y.browser.min.js'), 'utf8');

// A page with the real bundle loaded, and an execInTab that runs the
// adapter's page-side function in it, as chrome.scripting would.
function pageWith(html) {
    const dom = new JSDOM(html, {runScripts: 'outside-only', url: 'https://example.test/'});
    dom.window.eval(BUNDLE);
    const execInTab = async (_tabId, details) => {
        const run = dom.window.eval(`(${details.func.toString()})`);
        return [await run(...details.args)];
    };
    return {execInTab, page: dom.window};
}

const PAGE = '<!doctype html><html lang="en"><body style="background:#fff;color:#000">'
    + '<main><h1>Title</h1><p style="color:#767676">Grey text</p><img src="IMG_1234.jpg" alt="IMG_1234.jpg"></main></body></html>';

describe('extension surea11y adapter: notes, margins and details', () => {
    test('names the core release, checks readiness, and keeps margins', async () => {
        const {execInTab, page} = pageWith(PAGE);
        // jsdom never loads the image, so the page is not ready.
        const native = await SUREA11Y.runInTab(1, {pageReadyTimeoutMs: 0}, {execInTab});
        // The release of the bundle that ran, whichever core is installed
        // beside it (the bundle is rebuilt from it by build:extension-shared).
        assert.ok(native.engineVersion);
        assert.equal(native.engineVersion, page.A11Y_LABS_BROWSER.version);
        assert.equal(native.pageReadiness.ready, false);
        assert.equal(native.pageReadiness.pending.images, 1);

        const canonical = SUREA11Y.canonicalize(native, {engine: {id: '@surea11y', name: 'surea11y', version: null}});
        assert.equal(canonical.engine.version, native.engineVersion, 'the result\'s release wins over the caller\'s');
        assert.deepEqual(canonical.notices.map((n) => n.code), ['page-not-ready']);
        assert.match(canonical.notices[0].message, /\(1 image, after waiting \d+ ms\)/);
        const contrast = canonical.margins.find((m) => m.ruleId === 'contrast-minimum');
        assert.ok(contrast, 'contrast-minimum reports a margin');
        assert.equal(contrast.value.toFixed(2), '4.54');
        assert.ok(contrast.title && contrast.title !== 'contrast-minimum', 'named by the rule catalog');
    });

    test('notes a scope that matched nothing', async () => {
        const {execInTab} = pageWith(PAGE);
        const native = await SUREA11Y.runInTab(1, {contextSelector: '#missing', pageReadyTimeoutMs: 0}, {execInTab});
        const canonical = SUREA11Y.canonicalize(native, {});
        assert.deepEqual(JSON.parse(JSON.stringify(native.contextMatch)), {elementCount: 0, unmatchedSelectors: ['#missing']});
        assert.ok(canonical.notices.some((n) => n.code === 'context-unmatched'));
    });

    test('keeps what the engine found for an occurrence', async () => {
        const {execInTab} = pageWith(PAGE);
        const native = await SUREA11Y.runInTab(1, {pageReadyTimeoutMs: 0}, {execInTab});
        const canonical = SUREA11Y.canonicalize(native, {runOptions: {engineOptions: {findingsSource: 'atomic'}}});
        const alt = canonical.findings.find((f) => f.ruleId === 'img-alt-quality');
        assert.deepEqual(JSON.parse(JSON.stringify(alt.occurrences[0].details)), {altSignal: 'file-name'});
    });

    // The panel sends a standard as engineOptions.profile with its WCAG tags.
    const standard = (id) => ({
        runOnly: {type: 'tag', values: globalThis.A11Y_CONFORMANCE_TARGETS.CONFORMANCE_TARGETS[id].tags.slice()},
        engineOptions: {profile: id},
        pageReadyTimeoutMs: 0
    });

    test('applies a standard the bundle has, and records it', async () => {
        const {execInTab} = pageWith(PAGE);
        const native = await SUREA11Y.runInTab(1, standard('en301549-v3.2.1'), {execInTab});
        assert.equal(native.engine.profile, 'en301549-v3.2.1');
        assert.equal(native.profileUnavailable, null);
        const canonical = SUREA11Y.canonicalize(native, {});
        assert.deepEqual(JSON.parse(JSON.stringify(canonical.runOptions.conformanceProfile)), {id: 'en301549-v3.2.1', label: 'EN 301 549 V3.2.1'});
        assert.ok(!canonical.notices.some((n) => n.code === 'profile-unavailable'));
    });

    test('scans with the standard\'s WCAG tags when the bundle lacks its profile, and says so', async (t) => {
        // A standard the lab knows and this core release does not.
        const real = globalThis.A11Y_CONFORMANCE_TARGETS;
        const missing = {label: 'Example Standard 1.0', tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']};
        const SCAN_TARGETS = {...real.SCAN_TARGETS, 'example-1.0': missing};
        globalThis.A11Y_CONFORMANCE_TARGETS = {
            ...real,
            SCAN_TARGETS,
            CONFORMANCE_TARGETS: {...real.CONFORMANCE_TARGETS, 'example-1.0': missing},
            targetLabel: (id) => (SCAN_TARGETS[id] ? SCAN_TARGETS[id].label : null)
        };
        t.after(() => { globalThis.A11Y_CONFORMANCE_TARGETS = real; });

        const {execInTab} = pageWith(PAGE);
        const native = await SUREA11Y.runInTab(1, standard('example-1.0'), {execInTab});
        assert.equal(native.profileUnavailable, 'example-1.0');
        assert.equal(native.engine.wcagVersion, '2.1', 'WCAG 2.1 A and AA, not every rule');
        const canonical = SUREA11Y.canonicalize(native, {});
        const note = canonical.notices.find((n) => n.code === 'profile-unavailable');
        assert.match(note.message, /no Example Standard 1\.0 profile/);
        assert.equal(canonical.runOptions.conformanceProfile, null);
    });
});

describe('extension surea11y adapter: the scan\'s selection', () => {
    const DUP = '<!doctype html><html lang="en"><body><main><h1 id="x">A</h1><p id="x">B</p></main></body></html>';
    const ruleIdsOf = (native) => new Set((native.checksResults || []).map((r) => r && r.ruleId));

    test('the tags of one WCAG version at one level go to core as that target', async () => {
        const {execInTab} = pageWith(DUP);
        const warned = [];
        const warn = console.warn;
        console.warn = (...a) => warned.push(a.join(' '));
        let native;
        try {
            native = await SUREA11Y.runInTab(1, {
                runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']},
                pageReadyTimeoutMs: 0
            }, {execInTab});
        } finally {
            console.warn = warn;
        }
        assert.deepEqual(native.wcagTarget, {version: '2.2', level: 'AA'});
        assert.equal(native.engine.wcagVersion, '2.2');
        assert.ok(!warned.some((w) => /wcag22a/.test(w)), 'no "no tag named" warning');
        assert.ok(!ruleIdsOf(native).has('duplicate-id'), '4.1.1 is not part of WCAG 2.2');
        const canonical = SUREA11Y.canonicalize(native, {});
        assert.deepEqual(JSON.parse(JSON.stringify(canonical.runOptions.wcagTarget)), {version: '2.2', level: 'AA'});
    });

    test('the scan\'s level applies before the tags become a target, and 2.1 keeps 4.1.1', async () => {
        const {execInTab} = pageWith(DUP);
        const native = await SUREA11Y.runInTab(1, {
            runOnly: {tags: ['wcag2a', 'wcag21a']}, wcagLevel: 'AA', pageReadyTimeoutMs: 0
        }, {execInTab});
        assert.deepEqual(native.wcagTarget, {version: '2.1', level: 'AA'});
        assert.ok(ruleIdsOf(native).has('duplicate-id'));
    });

    test('the scan\'s selection goes to core as its target, best-practices beside it', async () => {
        const {execInTab} = pageWith(DUP);
        const native = await SUREA11Y.runInTab(1, {
            selection: {version: '2.0', level: 'A', profile: null, bestPractices: true}, pageReadyTimeoutMs: 0
        }, {execInTab});
        assert.deepEqual(native.wcagTarget, {version: '2.0', level: 'A'});
        assert.equal(native.engine.wcagVersion, '2.0');
        assert.ok(ruleIdsOf(native).has('duplicate-id'), '4.1.1 is part of WCAG 2.0');
    });

    test('best-practices add to a standard', async () => {
        const {execInTab} = pageWith(PAGE);
        const native = await SUREA11Y.runInTab(1, {
            selection: {version: '2.0', level: 'AA', profile: 'section508', bestPractices: true}, pageReadyTimeoutMs: 0
        }, {execInTab});
        assert.equal(native.engine.profile, 'section508', 'the standard still applies');
        assert.ok(ruleIdsOf(native).has('region'), 'a best-practice rule ran');
    });

    test('a standard in the selection goes to core as its profile', async () => {
        const {execInTab} = pageWith(PAGE);
        const native = await SUREA11Y.runInTab(1, {
            selection: {version: '2.1', level: 'AA', profile: 'en301549-v3.2.1', bestPractices: false}, pageReadyTimeoutMs: 0
        }, {execInTab});
        assert.equal(native.engine.profile, 'en301549-v3.2.1');
        assert.equal(native.wcagTarget, null);
    });
});

test('a page with frames says the extension did not scan them', async () => {
    const {execInTab} = pageWith('<!doctype html><html lang="en"><body><main><h1>T</h1><iframe title="x" srcdoc="<img src=a.png>"></iframe></main></body></html>');
    const native = await SUREA11Y.runInTab(1, {pageReadyTimeoutMs: 0}, {execInTab});
    const canonical = SUREA11Y.canonicalize(native, {});
    const notice = canonical.notices.find((n) => n.code === 'frames-not-scanned');
    assert.match(notice.message, /This page has 1 frame \(iframe\), which the extension does not scan/);
});
