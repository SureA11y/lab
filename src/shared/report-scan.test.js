'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { scanProfile, scanStandardId, scanWcag, scanProfileFields } = require('./report-scan.js');

describe('a report\'s scan, as saved now', () => {
    test('a standard: its profile, and the WCAG it came to', () => {
        const scan = { profile: { id: 'section508', label: 'Section 508' }, wcag: { version: '2.0', level: 'AA' } };
        assert.deepEqual(scanProfile(scan), { id: 'section508', label: 'Section 508' });
        assert.equal(scanStandardId(scan), 'section508');
        assert.deepEqual(scanWcag(scan), { version: '2.0', level: 'AA' });
    });

    test('a WCAG profile is no standard', () => {
        const scan = { profile: { id: 'wcag22-aaa', label: 'WCAG 2.2 AAA' }, wcag: { version: '2.2', level: 'AAA' } };
        assert.equal(scanStandardId(scan), null);
        assert.deepEqual(scanProfile(scan), { id: 'wcag22-aaa', label: 'WCAG 2.2 AAA' });
    });
});

describe('a report\'s scan, as saved before', () => {
    test('conformanceProfile is its standard', () => {
        const scan = { wcagLevel: 'AA', wcagVersion: '2.1', conformanceProfile: { id: 'rgaa-4.1.2', label: 'RGAA 4.1.2' } };
        assert.deepEqual(scanProfile(scan), { id: 'rgaa-4.1.2', label: 'RGAA 4.1.2' });
        assert.equal(scanStandardId(scan), 'rgaa-4.1.2');
        assert.deepEqual(scanWcag(scan), { version: '2.1', level: 'AA' });
    });

    test('without one, its WCAG level is its profile', () => {
        assert.deepEqual(scanProfile({ wcagLevel: 'AA', wcagVersion: '2.2', conformanceProfile: null }), { id: 'wcag22-aa', label: 'WCAG 2.2 AA' });
        assert.deepEqual(scanProfile({ wcagLevel: 'aaa' }), { id: 'wcag22-aaa', label: 'WCAG 2.2 AAA' });
        assert.equal(scanStandardId({ wcagLevel: 'AA' }), null);
    });

    test('another WCAG version, which no profile is, keeps its name', () => {
        assert.deepEqual(scanProfile({ wcagLevel: 'AA', wcagVersion: '2.1' }), { id: null, label: 'WCAG 2.1 AA' });
    });

    test('a scan that says nothing has no profile', () => {
        assert.equal(scanProfile({}), null);
        assert.equal(scanProfile(null), null);
        assert.equal(scanStandardId({}), null);
        assert.deepEqual(scanWcag({}), { version: null, level: null });
    });
});

describe('scanProfileFields', () => {
    test('what a new scan records: the standard applied, else its WCAG level', () => {
        assert.deepEqual(scanProfileFields({ standard: { id: 'section508', label: 'Section 508' }, version: '2.0', level: 'AA' }), {
            profile: { id: 'section508', label: 'Section 508' },
            wcag: { version: '2.0', level: 'AA' },
        });
        assert.deepEqual(scanProfileFields({ standard: null, version: '2.2', level: 'aa' }), {
            profile: { id: 'wcag22-aa', label: 'WCAG 2.2 AA' },
            wcag: { version: '2.2', level: 'AA' },
        });
    });

    test('reads back as it was written', () => {
        const fields = scanProfileFields({ standard: null, version: '2.2', level: 'A' });
        assert.deepEqual(scanProfile(fields), fields.profile);
        assert.deepEqual(scanWcag(fields), fields.wcag);
    });
});
