'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { WCAG_CRITERIA, criteriaForScope, criterionBySc } = require('./wcag-criteria');

describe('WCAG_CRITERIA table integrity', () => {
    test('every criterion has a well-formed dotted ref, a valid level and a title', () => {
        for (const c of WCAG_CRITERIA) {
            assert.match(c.sc, /^\d\.\d\.\d{1,2}$/, `bad sc: ${c.sc}`);
            assert.ok(['A', 'AA', 'AAA'].includes(c.level), `bad level for ${c.sc}`);
            assert.ok(c.title && typeof c.title === 'string', `missing title for ${c.sc}`);
            assert.ok(['2.0', '2.1', '2.2'].includes(c.addedIn), `bad addedIn for ${c.sc}`);
        }
    });

    test('criteria are unique', () => {
        const seen = new Set(WCAG_CRITERIA.map(c => c.sc));
        assert.equal(seen.size, WCAG_CRITERIA.length);
    });

    test('the two-digit criteria are present and not mangled into three segments', () => {
        for (const sc of ['1.4.10', '1.4.11', '1.4.12', '1.4.13', '2.4.10', '2.4.11', '2.4.12', '2.4.13']) {
            assert.ok(criterionBySc(sc), `missing ${sc}`);
        }
    });

    test('4.1.1 Parsing is the only criterion marked as removed', () => {
        const removed = WCAG_CRITERIA.filter(c => c.removedIn);
        assert.deepEqual(removed.map(c => c.sc), ['4.1.1']);
        assert.equal(removed[0].removedIn, '2.2');
    });
});

describe('criteriaForScope', () => {
    test('matches the published criterion counts for each version and level', () => {
        const counts = {
            '2.0': { A: 25, AA: 38, AAA: 61 },
            '2.1': { A: 30, AA: 50, AAA: 78 },
            '2.2': { A: 31, AA: 55, AAA: 86 }
        };
        for (const [version, byLevel] of Object.entries(counts)) {
            for (const [level, expected] of Object.entries(byLevel)) {
                assert.equal(criteriaForScope({ level, version }).length, expected, `WCAG ${version} ${level}`);
            }
        }
    });

    test('conformance is cumulative: AA includes every A criterion', () => {
        const a = criteriaForScope({ level: 'A' }).map(c => c.sc);
        const aa = new Set(criteriaForScope({ level: 'AA' }).map(c => c.sc));
        for (const sc of a) assert.ok(aa.has(sc), `${sc} missing from AA scope`);
    });

    test('4.1.1 applies to 2.0 and 2.1 but is gone from 2.2', () => {
        const has = (version) => criteriaForScope({ level: 'A', version }).some(c => c.sc === '4.1.1');
        assert.equal(has('2.0'), true);
        assert.equal(has('2.1'), true);
        assert.equal(has('2.2'), false);
    });

    test('criteria added in a later version are excluded from an earlier scope', () => {
        const scs = (version) => new Set(criteriaForScope({ level: 'AA', version }).map(c => c.sc));
        assert.equal(scs('2.0').has('1.4.10'), false, '1.4.10 arrived in 2.1');
        assert.equal(scs('2.1').has('1.4.10'), true);
        assert.equal(scs('2.1').has('2.5.8'), false, '2.5.8 arrived in 2.2');
        assert.equal(scs('2.2').has('2.5.8'), true);
    });

    test('defaults to WCAG 2.2 AA', () => {
        assert.deepEqual(criteriaForScope().map(c => c.sc), criteriaForScope({ level: 'AA', version: '2.2' }).map(c => c.sc));
    });

    test('an unknown level falls back to AA and an unknown version to the newest', () => {
        assert.equal(criteriaForScope({ level: 'bogus' }).length, criteriaForScope({ level: 'AA' }).length);
        assert.equal(criteriaForScope({ version: '9.9' }).length, criteriaForScope({ version: '2.2' }).length);
    });

    test('level input is case-insensitive', () => {
        assert.equal(criteriaForScope({ level: 'aa' }).length, criteriaForScope({ level: 'AA' }).length);
    });
});

describe('criterionBySc', () => {
    test('finds a criterion and reports its level', () => {
        assert.equal(criterionBySc('1.4.3').level, 'AA');
        assert.equal(criterionBySc('2.5.8').level, 'AA');
        assert.equal(criterionBySc('1.1.1').level, 'A');
    });

    test('tolerates surrounding whitespace', () => {
        assert.equal(criterionBySc('  1.4.3  ').sc, '1.4.3');
    });

    test('returns null for an unknown or empty ref', () => {
        assert.equal(criterionBySc('9.9.9'), null);
        assert.equal(criterionBySc(''), null);
        assert.equal(criterionBySc(null), null);
    });
});
