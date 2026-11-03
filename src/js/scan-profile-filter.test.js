'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

// The module reads a scan's profiles through the shared report-scan.js, as the
// page has it on globalThis.
globalThis.A11Y_REPORT_SCAN = require('../shared/report-scan.js');

let mod;
before(async () => {
    mod = await import('./scan-profile-filter.js');
});

const wcagAA = { id: 'wcag22-aa', label: 'WCAG 2.2 AA' };
const rgaa = { id: 'rgaa-4.1.2', label: 'RGAA 4.1.2' };
const aria = { id: 'wai-aria-1.2', label: 'WAI-ARIA 1.2' };

const scan = (profile, extra = {}) => ({ id: 's', profile, wcag: { version: '2.2', level: 'AA' }, ...extra });
const unknown = () => ({ id: 'u', profile: null, wcag: { version: null, level: null } });

describe('collectScanProfiles', () => {
    test('lists each profile once, in the order first met, with its label', () => {
        const { profiles, useful } = mod.collectScanProfiles([scan(wcagAA), scan(rgaa), scan(wcagAA)]);
        assert.deepEqual(profiles, [
            { key: 'wcag22-aa', label: 'WCAG 2.2 AA' },
            { key: 'rgaa-4.1.2', label: 'RGAA 4.1.2' },
        ]);
        assert.equal(useful, true);
    });

    test('is not useful when every scan has the same profile', () => {
        assert.equal(mod.collectScanProfiles([scan(rgaa), scan(rgaa)]).useful, false);
        assert.equal(mod.collectScanProfiles([scan(rgaa)]).useful, false);
        assert.equal(mod.collectScanProfiles([]).useful, false);
    });

    test('is not useful when every scan was checked against the same several profiles', () => {
        const both = () => scan(aria, { profiles: [wcagAA, aria] });
        const out = mod.collectScanProfiles([both(), both()]);
        assert.equal(out.profiles.length, 2);
        assert.equal(out.useful, false);
    });

    test('offers the scans that name no profile as "Unknown profile", last', () => {
        const { profiles, useful } = mod.collectScanProfiles([unknown(), scan(rgaa)]);
        assert.deepEqual(profiles, [
            { key: 'rgaa-4.1.2', label: 'RGAA 4.1.2' },
            { key: mod.UNKNOWN_PROFILE, label: 'Unknown profile' },
        ]);
        assert.equal(useful, true);
    });

    test('reads a report saved in the older format', () => {
        const old = { id: 'o', wcagLevel: 'AA', wcagVersion: '2.2', conformanceProfile: { id: 'rgaa-4.1.2', label: 'RGAA 4.1.2' } };
        const { profiles } = mod.collectScanProfiles([old, scan(wcagAA)]);
        assert.deepEqual(profiles.map((p) => p.key), ['rgaa-4.1.2', 'wcag22-aa']);
    });

    test('keys an older WCAG version, which has no profile id, by its label', () => {
        const wcag21 = { id: 'w', wcag: { version: '2.1', level: 'AA' }, profile: null };
        const { profiles } = mod.collectScanProfiles([wcag21, scan(wcagAA)]);
        assert.deepEqual(profiles[0], { key: 'WCAG 2.1 AA', label: 'WCAG 2.1 AA' });
    });
});

describe('scanMatchesProfileFilter', () => {
    test('an empty selection matches every scan', () => {
        const filter = mod.makeProfileFilter([]);
        assert.equal(mod.isProfileFilterActive(filter), false);
        assert.equal(mod.scanMatchesProfileFilter(scan(rgaa), filter), true);
        assert.equal(mod.scanMatchesProfileFilter(unknown(), filter), true);
    });

    test('a scan matches when its profile is picked', () => {
        const filter = mod.makeProfileFilter(['rgaa-4.1.2']);
        assert.equal(mod.isProfileFilterActive(filter), true);
        assert.equal(mod.scanMatchesProfileFilter(scan(rgaa), filter), true);
        assert.equal(mod.scanMatchesProfileFilter(scan(wcagAA), filter), false);
    });

    test('picking two profiles shows the scans of either', () => {
        const filter = mod.makeProfileFilter(['rgaa-4.1.2', 'wcag22-aa']);
        assert.equal(mod.scanMatchesProfileFilter(scan(rgaa), filter), true);
        assert.equal(mod.scanMatchesProfileFilter(scan(wcagAA), filter), true);
        assert.equal(mod.scanMatchesProfileFilter(unknown(), filter), false);
    });

    test('a scan of several profiles matches when any of them is picked', () => {
        const several = scan(aria, { profiles: [wcagAA, aria] });
        assert.equal(mod.scanMatchesProfileFilter(several, mod.makeProfileFilter(['wai-aria-1.2'])), true);
        assert.equal(mod.scanMatchesProfileFilter(several, mod.makeProfileFilter(['wcag22-aa'])), true);
        assert.equal(mod.scanMatchesProfileFilter(several, mod.makeProfileFilter(['rgaa-4.1.2'])), false);
    });

    test('"Unknown profile" picks the scans that name none', () => {
        const filter = mod.makeProfileFilter([mod.UNKNOWN_PROFILE]);
        assert.equal(mod.scanMatchesProfileFilter(unknown(), filter), true);
        assert.equal(mod.scanMatchesProfileFilter(scan(rgaa), filter), false);
    });
});
