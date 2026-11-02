'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('an installed standard pack\'s profiles become targets; the lab\'s own stay as they are', () => {
    const t = require('./conformance-targets.js');
    const before = JSON.stringify(t.SCAN_TARGETS['en301549-v3.2.1']);
    const added = t.registerStandardProfiles([
        { profiles: [{ id: 'en301549-v3.2.1', label: 'Changed', wcagVersion: '2.2' }, { id: 'demo-2.0', label: 'Demo Standard 2.0', wcagVersion: '2.1' }, { id: 'Not An Id', label: 'x' }] },
    ]);
    assert.deepEqual(added, ['demo-2.0']);
    assert.equal(JSON.stringify(t.SCAN_TARGETS['en301549-v3.2.1']), before);
    assert.equal(t.scanTargetId('demo-2.0'), 'demo-2.0');
    assert.equal(t.profileId('demo-2.0'), 'demo-2.0');
    assert.deepEqual(t.resolveScanTarget({ profile: 'demo-2.0' }), { level: 'AA', version: '2.1', profile: 'demo-2.0' });
    assert.equal(t.SCAN_TARGETS['demo-2.0'].label, 'Demo Standard 2.0');
    assert.ok(t.CONFORMANCE_TARGETS['demo-2.0'], 'a standard');
    assert.deepEqual(t.registerStandardProfiles([{ profiles: [{ id: 'demo-2.0' }] }]), [], 'once');
});

test('a scan step may name several profiles: a list, or ids separated by commas', () => {
    const t = require('./conformance-targets.js');
    t.registerStandardProfiles([{ profiles: [{ id: 'wai-aria-1.2', label: 'WAI-ARIA 1.2', wcagVersion: '2.2' }] }]);
    assert.deepEqual(t.profileList(' WAI-ARIA-1.2 , wcag22-aa,wai-aria-1.2'), ['wai-aria-1.2', 'wcag22-aa']);
    assert.deepEqual(t.profileList(['wcag22-aa', '', 7]), ['wcag22-aa']);
    // The WCAG level first, then the standards in the order given.
    assert.deepEqual(t.scanTargetIds(['wai-aria-1.2', 'wcag22-aaa']), ['wcag22-aaa', 'wai-aria-1.2']);
    assert.deepEqual(t.resolveScanTarget({ profile: 'wai-aria-1.2,wcag22-aaa' }),
        { level: 'AAA', version: '2.2', profile: 'wai-aria-1.2', profiles: ['wcag22-aaa', 'wai-aria-1.2'] });
    assert.deepEqual(t.resolveScanTarget({ profile: ['en301549-v3.2.1', 'wai-aria-1.2'] }),
        { level: 'AA', version: '2.1', profile: 'en301549-v3.2.1', profiles: ['en301549-v3.2.1', 'wai-aria-1.2'] });
    // One profile, as a list or not, reads as it always has.
    assert.deepEqual(t.resolveScanTarget({ profile: ['wcag22-a'] }), t.resolveScanTarget({ profile: 'wcag22-a' }));
    assert.equal('profiles' in t.resolveScanSelection({ profile: ['en301549-v4.1.1'] }), false);
    assert.deepEqual(t.resolveScanSelection({ profile: ['wcag22-aa', 'wai-aria-1.2'] }).profiles, ['wcag22-aa', 'wai-aria-1.2']);
    assert.equal(t.selectionLabel(t.resolveScanSelection({ profile: ['wai-aria-1.2', 'wcag22-aa'] })), 'WCAG 2.2 AA + WAI-ARIA 1.2');
    assert.deepEqual(t.selectionFromRunOnly({ profile: ['wcag22-aa', 'wai-aria-1.2'] }).profiles, ['wcag22-aa', 'wai-aria-1.2']);
});

test('a scan step\'s profiles are checked: unknown ids, and two WCAG levels', () => {
    const t = require('./conformance-targets.js');
    assert.deepEqual(t.scanTargetProblems('wcag22-aa'), []);
    assert.deepEqual(t.scanTargetProblems(['wcag22-aa', 'en301549-v4.1.1']), []);
    assert.deepEqual(t.scanTargetProblems('wcag22-aa,nope'), ['"nope" is not a profile']);
    assert.match(t.scanTargetProblems(['wcag22-a', 'wcag22-aaa'])[0], /WCAG 2\.2 A and WCAG 2\.2 AAA are two WCAG levels/);
    // Several profiles need an engine that applies standards in full.
    assert.equal(t.targetSupported(['wcag22-aa', 'en301549-v4.1.1'], 'version'), false);
    assert.equal(t.targetSupported(['wcag22-aa', 'en301549-v4.1.1'], 'standard'), true);
});
