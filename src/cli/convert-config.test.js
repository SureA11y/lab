'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { convertDocument, main } = require('./convert-config');
const { checkSpec } = require('./check-spec');

const spec = (actions, extra = {}) => ({ type: 'a11y-run-spec', specVersion: 1, url: 'https://example.com/', actions, ...extra });
const steps = (doc) => convertDocument(doc).doc.actions;

describe('convertDocument', () => {
    test('a scan\'s list of profiles is its own: kept, with a retired profile replaced once', () => {
        const { doc, changes } = convertDocument(spec([
            { type: 'a11yScan', profile: ['wcag22-aa', 'en301549-v4.1.1'] },
            { type: 'a11yScan', profile: ['section508', 'wcag22-aa', 'en301549-v3.2.1'] },
        ], { profile: 'en301549-v4.1.1' }));
        assert.deepEqual(doc.actions.map((s) => s.profile), [['wcag22-aa', 'en301549-v4.1.1'], ['wcag22-aa', 'en301549-v3.2.1']]);
        assert.ok(changes.some((c) => /profile "section508" → "wcag22-aa"/.test(c)));
        // Beside another WCAG level, the one it already names stays.
        assert.deepEqual(steps(spec([{ type: 'a11yScan', profile: ['section508', 'wcag22-aaa'] }]))[0].profile, ['wcag22-aaa']);
    });

    test('a scan\'s bare level or target becomes its profile, a separate standard winning as it did', () => {
        assert.deepEqual(steps(spec([
            { type: 'a11yScan', wcagLevel: 'AA' },
            { type: 'a11yScan', wcagLevel: 'en301549-v4.1.1' },
            { type: 'a11yScan', wcagLevel: 'AAA', conformanceProfile: 'en301549-v3.2.1' },
            { type: 'a11yScan', wcagLevel: '' },
        ])), [
            { type: 'a11yScan', profile: 'wcag22-aa' },
            { type: 'a11yScan', profile: 'en301549-v4.1.1' },
            { type: 'a11yScan', profile: 'en301549-v3.2.1' },
            { type: 'a11yScan' },
        ]);
    });

    test('the Section 508 profile becomes WCAG 2.2 AA, for a scan, the run and the app\'s run, and says so', () => {
        const { doc, changes } = convertDocument(spec([{ type: 'a11yScan', profile: 'Section508' }], { profile: 'section508' }));
        assert.equal('profile' in doc, false, 'a run has no profile any more');
        assert.deepEqual(doc.actions, [{ type: 'a11yScan', profile: 'wcag22-aa' }]);
        assert.match(changes[0], /^profile "section508" → "wcag22-aa" \(the lab no longer has it/);
        assert.ok(changes.some((c) => /^step 1: profile "Section508" → "wcag22-aa" \(the lab no longer has it: it checked WCAG 2\.0 AA, and now checks WCAG 2\.2 AA\)$/.test(c)));
        assert.deepEqual(checkSpec(doc).errors, []);

        const config = convertDocument({ version: 1, type: 'a11y-ui-src-config', state: { 'run-profile': 'section508', 'actions-workflow': [] } });
        assert.equal('run-profile' in config.doc.state, false);
        assert.match(config.changes[0], /^the run's profile "section508" → "wcag22-aa"/);
    });

    test('a scan\'s opt-in rules, RGAA\'s, are dropped, and an RGAA profile is left for a person', () => {
        const { doc, changes } = convertDocument(spec([
            { type: 'a11yScan', optInRules: 'none' },
            { type: 'a11yScan', profile: 'rgaa-4.1.2' },
        ]));
        assert.deepEqual(doc.actions, [{ type: 'a11yScan' }, { type: 'a11yScan', profile: 'rgaa-4.1.2' }]);
        assert.deepEqual(changes, ['step 1: optInRules "none" dropped (the lab no longer runs RGAA\'s rules)']);
        // The check after says what is left to do.
        assert.match(checkSpec(doc).errors.join('\n'), /"rgaa-4\.1\.2" is not a profile/);
    });

    test('a scan\'s disableRules joins its excludeRuleIds', () => {
        const { doc, changes } = convertDocument(spec([
            { type: 'a11yScan', disableRules: ['duplicate-id', 'region'] },
            { type: 'a11yScan', excludeRuleIds: 'region', disableRules: 'region, list' },
        ]));
        assert.deepEqual(doc.actions, [
            { type: 'a11yScan', excludeRuleIds: 'duplicate-id, region' },
            { type: 'a11yScan', excludeRuleIds: 'region, list' },
        ]);
        assert.deepEqual(changes, [
            'step 1: disableRules ["duplicate-id","region"] → excludeRuleIds "duplicate-id, region"',
            'step 2: disableRules "region, list" → excludeRuleIds "region, list"',
        ]);
        assert.deepEqual(checkSpec(doc).errors, []);
    });

    test('a scan\'s timeout becomes its wait timeout, and its stage limit only when longer than a minute', () => {
        assert.deepEqual(steps(spec([{ type: 'a11yScan', timeout: 10000 }, { type: 'a11yScan', timeout: 120000 }])), [
            { type: 'a11yScan', waitTimeout: 10000 },
            { type: 'a11yScan', waitTimeout: 120000, stageTimeout: 120000 },
        ]);
    });

    test('programmatic text, a capture\'s name, a masked setValue and getTextIntoVariable', () => {
        assert.deepEqual(steps(spec([
            { type: 'click', selector: '#a', programmatic: 'true' },
            { type: 'clickByText', labelText: 'Go', programmatic: 'false' },
            { type: 'screenshot', name: 'home' },
            { type: 'evidenceCapture', label: 'Kept', title: 'Dropped' },
            { type: 'setValue', selector: '#p', valueMasked: true },
            { type: 'getTextIntoVariable', selector: 'h1', var: 't' },
        ])), [
            { type: 'click', selector: '#a', programmatic: true },
            { type: 'clickByText', labelText: 'Go', programmatic: false },
            { type: 'screenshot', label: 'home' },
            { type: 'evidenceCapture', label: 'Kept' },
            { type: 'setPassword', selector: '#p', valueMasked: true },
            { type: 'getText', selector: 'h1', var: 't' },
        ]);
    });

    test('the shapes the old examples showed', () => {
        assert.deepEqual(steps(spec([
            { type: 'save', variants: ['png', 'mhtml'] },
            { type: 'hoverByText', selector: 'nav', text: 'Products' },
        ])), [
            { type: 'evidenceCapture', evidenceVariant: 'both' },
            { type: 'hoverByText', selector: 'nav', labelText: 'Products' },
        ]);
    });

    test('reaches nested steps and custom steps, numbered as the app numbers them', () => {
        const { doc, changes } = convertDocument(spec(
            [{ type: 'group', actions: [{ type: 'a11yScan' }, { type: 'if', selectorExists: '#x', actions: [], elseActions: [{ type: 'a11yScan', wcagLevel: 'A' }] }] }],
            { customSteps: [{ id: 'login', actions: [{ type: 'click', selector: '#a', programmatic: 'true' }] }] }
        ));
        assert.equal(doc.actions[0].actions[1].elseActions[0].profile, 'wcag22-a');
        assert.equal(doc.customSteps[0].actions[0].programmatic, true);
        assert.deepEqual(changes, [
            'step 1.2.1: wcagLevel "A" → profile "wcag22-a"',
            'custom step 1 "login", step 1: programmatic "true" → true',
        ]);
    });

    test('a spec\'s tags or wcag become its profile, left out when it is the default, with what no profile keeps', () => {
        assert.equal('tags' in convertDocument(spec([], { tags: ['wcag2a', 'wcag2aa', 'wcag22aa'] })).doc, false);
        assert.equal(convertDocument(spec([], { tags: ['wcag2a', 'wcag2aa', 'wcag22aa'] })).doc.profile, undefined);

        const { doc, notes } = convertDocument(spec([{ type: 'a11yScan' }], { wcag: { version: '2.1', level: 'AAA', bestPractice: true } }));
        // A run has no profile any more: the one they come to goes on its scans.
        assert.deepEqual(doc.actions, [{ type: 'a11yScan', profile: 'wcag22-aaa' }]);
        assert.equal('profile' in doc, false);
        assert.equal('wcag' in doc, false);
        assert.equal(notes.length, 2);
        assert.match(notes[0], /WCAG 2\.1, which no profile is/);
        assert.match(notes[1], /best-practice rules for the whole run/);
    });

    test('the run\'s profile goes on the scans that have none, nested and custom ones too; the default one is just dropped', () => {
        const { doc, changes } = convertDocument({
            version: 1,
            type: 'a11y-ui-src-config',
            state: {
                'run-profile': 'en301549-v4.1.1',
                'actions-workflow': [
                    { type: 'a11yScan', profile: '' },
                    { type: 'a11yScan', profile: 'wcag22-aaa' },
                    { type: 'group', actions: [{ type: 'a11yScan' }] },
                ],
                'custom-steps-json': JSON.stringify([{ id: 'c', actions: [{ type: 'a11yScan' }] }]),
            },
        });
        assert.equal('run-profile' in doc.state, false);
        assert.deepEqual(doc.state['actions-workflow'], [
            { type: 'a11yScan', profile: 'en301549-v4.1.1' },
            { type: 'a11yScan', profile: 'wcag22-aaa' },
            { type: 'group', actions: [{ type: 'a11yScan', profile: 'en301549-v4.1.1' }] },
        ]);
        assert.deepEqual(JSON.parse(doc.state['custom-steps-json'])[0].actions, [{ type: 'a11yScan', profile: 'en301549-v4.1.1' }]);
        assert.equal(changes[0], 'the run\'s profile "en301549-v4.1.1" put on each scan that has none');

        const plain = convertDocument(spec([{ type: 'a11yScan', profile: '' }], { profile: 'wcag22-aa' }));
        assert.deepEqual(plain.doc.actions, [{ type: 'a11yScan' }]);
        assert.equal('profile' in plain.doc, false);
    });

    test('a scan no longer saves evidence: its variant and the run\'s format go, the Save evidence step stays', () => {
        const { doc, changes } = convertDocument({
            version: 1,
            type: 'a11y-ui-src-config',
            state: {
                'evidence-save-selector': 'png',
                'exclude-selectors-global': '.ads\n.chat,\n  .cookie',
                'actions-workflow': [
                    { type: 'a11yScan', evidenceVariant: 'both' },
                    { type: 'evidenceCapture', evidenceVariant: 'png' },
                ],
            },
        });
        assert.equal('evidence-save-selector' in doc.state, false);
        assert.deepEqual(doc.state['actions-workflow'], [{ type: 'a11yScan', exclude: '.ads, .chat, .cookie' }, { type: 'evidenceCapture', evidenceVariant: 'png' }]);
        assert.match(changes.join('\n'), /the run's evidence format "png" dropped \(a scan no longer saves evidence: add a Save evidence step/);
        assert.match(changes.join('\n'), /step 1: evidenceVariant "both" dropped/);
    });

    test('a run\'s Include and Exclude selectors go onto its scans, as the run applied them', () => {
        const { doc, changes } = convertDocument(spec([
            { type: 'a11yScan', label: 'Home' },
            { type: 'a11yScan', label: 'Own include', context: '#app', exclude: ['.chat', '.ads'] },
            { type: 'repeat', repetitions: 2, actions: [{ type: 'a11yScan', label: 'Nested' }] },
            { type: 'click', selector: '#next' },
        ], {
            context: 'main',
            exclude: '.ads',
            customSteps: [{ id: 'check', actions: [{ type: 'a11yScan', exclude: '.banner' }] }],
        }));
        assert.ok(!('context' in doc));
        assert.ok(!('exclude' in doc));
        assert.deepEqual(doc.actions, [
            { type: 'a11yScan', label: 'Home', context: 'main', exclude: '.ads' },
            // Its own Include replaced the run's; it excluded the run's .ads already.
            { type: 'a11yScan', label: 'Own include', context: '#app', exclude: ['.chat', '.ads'] },
            { type: 'repeat', repetitions: 2, actions: [{ type: 'a11yScan', label: 'Nested', context: 'main', exclude: '.ads' }] },
            { type: 'click', selector: '#next' },
        ]);
        assert.deepEqual(doc.customSteps[0].actions, [{ type: 'a11yScan', exclude: '.ads, .banner', context: 'main' }]);
        assert.match(changes[0], /the run's Include selectors "main" put on each scan that has none/);
        assert.match(changes[1], /the run's Exclude selectors "\.ads" added to each scan's/);
        // The spec checks what it did, so it runs again.
        assert.equal(checkSpec(doc).ok, true);
    });

    test('a configuration\'s Include and Exclude selectors, one per line or not, go onto its scans', () => {
        const { doc, changes } = convertDocument({
            version: 1,
            type: 'a11y-ui-src-config',
            state: {
                'scan-context': 'main',
                'exclude-selectors-global': '.ads\n.chat,\n  .cookie',
                'actions-workflow': [{ type: 'a11yScan', label: 'Home' }],
            },
        });
        for (const key of ['scan-context', 'exclude-selectors-global', 'scan-exclude']) assert.ok(!(key in doc.state), key);
        assert.deepEqual(doc.state['actions-workflow'], [{ type: 'a11yScan', label: 'Home', context: 'main', exclude: '.ads, .chat, .cookie' }]);
        assert.equal(changes.length, 4);
    });

    test('a run without selectors leaves its scans as they are', () => {
        const { doc, changes } = convertDocument(spec([{ type: 'a11yScan', exclude: '.ads' }], { context: '', exclude: [] }));
        assert.deepEqual(doc.actions, [{ type: 'a11yScan', exclude: '.ads' }]);
        assert.deepEqual(changes, []);
    });

    test('a scan\'s crawl, and the probes it carried, are dropped', () => {
        const { doc, changes } = convertDocument(spec([{ type: 'a11yScan', label: 'Home', crawl: true, probes: {} }]));
        assert.deepEqual(doc.actions, [{ type: 'a11yScan', label: 'Home' }]);
        assert.deepEqual(changes, [
            'step 1: crawl true dropped (a scan no longer crawls other pages first)',
            'step 1: probes {} dropped (a scan no longer crawls other pages first)',
        ]);
    });

    test('Skip iteration\'s Literal equals, which nothing read, is dropped', () => {
        const { doc, changes } = convertDocument(spec([{ type: 'repeat', actions: [{ type: 'skipIteration', selectorExists: '.x', textEquals: 'Sold out' }] }]));
        assert.deepEqual(doc.actions[0].actions, [{ type: 'skipIteration', selectorExists: '.x' }]);
        assert.match(changes[0], /^step 1\.1: textEquals "Sold out" dropped \(it was never read: use Element selector :ctx with Text equals\)$/);
    });

    test('a saved configuration: its form\'s steps, its custom steps text and its saved run spec', () => {
        const { kind, doc, changes } = convertDocument({
            version: 1,
            type: 'a11y-ui-src-config',
            state: {
                'url-input': 'https://example.com/',
                'actions-workflow': [{ type: 'a11yScan', wcagLevel: 'AA' }],
                'custom-steps-json': JSON.stringify([{ id: 'c', actions: [{ type: 'a11yScan', wcagLevel: 'A' }] }]),
            },
            runSpec: spec([{ type: 'a11yScan', wcagLevel: 'AA' }], { tags: ['wcag22aa'] }),
        });
        assert.equal(kind, 'config');
        assert.deepEqual(doc.state['actions-workflow'], [{ type: 'a11yScan', profile: 'wcag22-aa' }]);
        assert.deepEqual(JSON.parse(doc.state['custom-steps-json'])[0].actions, [{ type: 'a11yScan', profile: 'wcag22-a' }]);
        assert.deepEqual(doc.runSpec.actions, [{ type: 'a11yScan', profile: 'wcag22-aa' }]);
        assert.equal('tags' in doc.runSpec, false);
        // The saved run spec repeats the form's steps: said once.
        assert.equal(changes.length, 2);
    });

    test('what it writes passes the check a run makes', () => {
        const { doc } = convertDocument(spec([
            { type: 'click', selector: '#a', programmatic: 'false' },
            { type: 'a11yScan', wcagLevel: 'AA', timeout: 10000 },
            { type: 'screenshot', name: 'home' },
        ], { tags: ['wcag2a'] }));
        assert.deepEqual(checkSpec(doc).errors, []);
        assert.deepEqual(checkSpec(doc).warnings, []);
    });

    test('a current file, or one that is not a config, is left alone', () => {
        const current = spec([{ type: 'a11yScan', profile: 'wcag22-aa' }]);
        assert.deepEqual(convertDocument(current), { kind: 'spec', doc: current, changes: [], notes: [] });
        assert.equal(convertDocument([{ name: 'a batch row' }]).kind, null);
    });
});

describe('convert-config.js', () => {
    function inTempDir(files, fn) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-'));
        for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
        const out = [];
        try {
            return fn(dir, out, (...a) => out.push(a.join(' ')));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    test('says what it would change and writes nothing without --write', () => {
        const text = JSON.stringify(spec([{ type: 'a11yScan', wcagLevel: 'AA' }]), null, 4) + '\n';
        inTempDir({ 'a.json': text, 'rows.json': '[{"name":"x"}]' }, (dir, out, log) => {
            assert.equal(main([dir], { log, error: log }), 0);
            assert.match(out.join('\n'), /step 1: wcagLevel "AA" → profile "wcag22-aa"/);
            assert.match(out.join('\n'), /1 file to change: run again with --write/);
            assert.equal(fs.readFileSync(path.join(dir, 'a.json'), 'utf8'), text);
        });
    });

    test('--write rewrites in place, with the file\'s own indentation, and a second pass has nothing to do', () => {
        const text = JSON.stringify(spec([{ type: 'a11yScan', wcagLevel: 'AA' }]), null, 4) + '\n';
        inTempDir({ 'a.json': text }, (dir, out, log) => {
            assert.equal(main([dir, '--write'], { log, error: log }), 0);
            const written = fs.readFileSync(path.join(dir, 'a.json'), 'utf8');
            assert.match(written, /^\{\n {4}"type"/);
            assert.ok(written.endsWith('\n'));
            assert.equal(JSON.parse(written).actions[0].profile, 'wcag22-aa');
            out.length = 0;
            assert.equal(main([dir], { log, error: log }), 0);
            assert.match(out.join('\n'), /Nothing to change/);
        });
    });

    test('a problem it cannot fix is said, with exit 4', () => {
        inTempDir({ 'a.json': JSON.stringify(spec([{ type: 'nope' }])) }, (dir, out, log) => {
            assert.equal(main([dir], { log, error: log }), 4);
            assert.match(out.join('\n'), /Still to fix: \$\.actions\[0\]\.type "nope"/);
        });
    });

    test('nothing to convert is bad usage', () => {
        const out = [];
        assert.equal(main([], { log: (m) => out.push(m), error: (m) => out.push(m) }), 2);
    });
});
