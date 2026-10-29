'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { validateCanonical, validateCanonicalOrThrow } = require('./validate-canonical');

function errorPaths(res) {
    return res.errors.map(e => e.path);
}

describe('validateCanonical: top-level shape', () => {
    test('rejects a non-object canonical', () => {
        for (const bad of [null, undefined, 'x', 42, [], true]) {
            const res = validateCanonical(bad);
            assert.equal(res.ok, false);
            assert.equal(res.errors[0].path, 'canonical');
        }
    });

    test('requires canonical.findings to be present', () => {
        const res = validateCanonical({});
        assert.equal(res.ok, false);
        assert.equal(res.errors[0].path, 'canonical.findings');
        assert.match(res.errors[0].message, /required/);
    });

    test('requires canonical.findings to be an array', () => {
        const res = validateCanonical({ findings: 'nope' });
        assert.equal(res.ok, false);
        assert.match(res.errors[0].message, /must be an array/);
    });

    test('an empty findings array is valid', () => {
        const res = validateCanonical({ findings: [] });
        assert.deepEqual(res, { ok: true, errors: [] });
    });

    test('a minimally-valid finding (uid + outcome) passes', () => {
        const res = validateCanonical({ findings: [{ uid: 'a', outcome: 'fail' }] });
        assert.equal(res.ok, true);
    });

    test('id alone (without uid) also satisfies the identifier requirement', () => {
        const res = validateCanonical({ findings: [{ id: 'color-contrast', outcome: 'fail' }] });
        assert.equal(res.ok, true);
    });
});

describe('validateCanonical: per-finding checks', () => {
    test('a non-object finding is reported and does not crash the rest of the pass', () => {
        const res = validateCanonical({ findings: [null, { uid: 'ok', outcome: 'pass' }] });
        assert.equal(res.ok, false);
        assert.equal(res.errors.length, 1);
        assert.equal(res.errors[0].path, 'canonical.findings[0]');
    });

    test('missing both uid and id is an error', () => {
        const res = validateCanonical({ findings: [{ outcome: 'fail' }] });
        assert.equal(res.ok, false);
        assert.ok(res.errors.some(e => /uid.*or.*id/.test(e.message)));
    });

    test('an empty-string or whitespace-only uid/id does not count as present', () => {
        const res = validateCanonical({ findings: [{ uid: '   ', id: '', outcome: 'fail' }] });
        assert.equal(res.ok, false);
    });

    test('outcome is required and must be one of the allowed values', () => {
        assert.equal(validateCanonical({ findings: [{ uid: 'a' }] }).ok, false);
        assert.equal(validateCanonical({ findings: [{ uid: 'a', outcome: 'bogus' }] }).ok, false);
        for (const outcome of ['fail', 'cantTell', 'pass', 'notApplicable']) {
            assert.equal(validateCanonical({ findings: [{ uid: 'a', outcome }] }).ok, true, outcome);
        }
    });

    test('severity is optional, but must be a valid value when present', () => {
        assert.equal(validateCanonical({ findings: [{ uid: 'a', outcome: 'fail' }] }).ok, true);
        // 'info' must be accepted: canonical-shared.js's normalizeSeverity() can emit it
        // for axe impacts of "info"/"informational", so it has to be a valid canonical severity.
        for (const severity of ['critical', 'serious', 'moderate', 'minor', 'info', 'unknown']) {
            assert.equal(validateCanonical({ findings: [{ uid: 'a', outcome: 'fail', severity }] }).ok, true, severity);
        }
        assert.equal(validateCanonical({ findings: [{ uid: 'a', outcome: 'fail', severity: 'bogus' }] }).ok, false);
        assert.equal(validateCanonical({ findings: [{ uid: 'a', outcome: 'fail', severity: '' }] }).ok, false);
    });

    test('wcag must be an object when present, wcag.sc must be an array of strings when present', () => {
        assert.equal(validateCanonical({ findings: [{ uid: 'a', outcome: 'fail', wcag: null }] }).ok, true);
        assert.equal(validateCanonical({ findings: [{ uid: 'a', outcome: 'fail', wcag: 'nope' }] }).ok, false);
        assert.equal(validateCanonical({ findings: [{ uid: 'a', outcome: 'fail', wcag: { sc: ['1.4.3'] } }] }).ok, true);
        assert.equal(validateCanonical({ findings: [{ uid: 'a', outcome: 'fail', wcag: { sc: 'nope' } }] }).ok, false);

        const res = validateCanonical({ findings: [{ uid: 'a', outcome: 'fail', wcag: { sc: ['1.4.3', 42] } }] });
        assert.equal(res.ok, false);
        assert.equal(errorPaths(res)[0], 'canonical.findings[0].wcag.sc[1]');
    });

    test('tags must be an array of strings when present', () => {
        assert.equal(validateCanonical({ findings: [{ uid: 'a', outcome: 'fail', tags: null }] }).ok, true);
        assert.equal(validateCanonical({ findings: [{ uid: 'a', outcome: 'fail', tags: 'nope' }] }).ok, false);
        assert.equal(validateCanonical({ findings: [{ uid: 'a', outcome: 'fail', tags: ['wcag2aa'] }] }).ok, true);

        const res = validateCanonical({ findings: [{ uid: 'a', outcome: 'fail', tags: ['ok', 42] }] });
        assert.equal(res.ok, false);
        assert.equal(errorPaths(res)[0], 'canonical.findings[0].tags[1]');
    });

    test('occurrences must be an array when present', () => {
        assert.equal(validateCanonical({ findings: [{ uid: 'a', outcome: 'fail', occurrences: null }] }).ok, true);
        assert.equal(validateCanonical({ findings: [{ uid: 'a', outcome: 'fail', occurrences: 'nope' }] }).ok, false);
        assert.equal(validateCanonical({ findings: [{ uid: 'a', outcome: 'fail', occurrences: [] }] }).ok, true);
    });
});

describe('validateCanonical: per-occurrence checks', () => {
    function withOcc(occ) {
        return { findings: [{ uid: 'a', outcome: 'fail', occurrences: [occ] }] };
    }

    test('a non-object occurrence is reported without checking further fields', () => {
        const res = validateCanonical(withOcc(null));
        assert.equal(res.ok, false);
        assert.equal(res.errors.length, 1);
        assert.equal(res.errors[0].path, 'canonical.findings[0].occurrences[0]');
    });

    test('a fully-valid occurrence passes', () => {
        const res = validateCanonical(withOcc({
            pageUrl: 'https://example.com/',
            target: ['.btn'],
            html: '<button class="btn"></button>',
            failureSummary: 'Fix it',
            evidence: { engineNode: {} }
        }));
        assert.equal(res.ok, true);
    });

    test('all occurrence fields are optional (an empty object passes)', () => {
        assert.equal(validateCanonical(withOcc({})).ok, true);
    });

    test('pageUrl must be a string when present (null is allowed)', () => {
        assert.equal(validateCanonical(withOcc({ pageUrl: null })).ok, true);
        assert.equal(validateCanonical(withOcc({ pageUrl: 42 })).ok, false);
    });

    test('target must be an array of strings when present (null is allowed)', () => {
        assert.equal(validateCanonical(withOcc({ target: null })).ok, true);
        assert.equal(validateCanonical(withOcc({ target: 'nope' })).ok, false);
        assert.equal(validateCanonical(withOcc({ target: ['.a', '.b'] })).ok, true);

        const res = validateCanonical(withOcc({ target: ['.a', 42] }));
        assert.equal(res.ok, false);
        assert.equal(errorPaths(res)[0], 'canonical.findings[0].occurrences[0].target[1]');
    });

    test('html must be a string when present (null is allowed)', () => {
        assert.equal(validateCanonical(withOcc({ html: null })).ok, true);
        assert.equal(validateCanonical(withOcc({ html: 42 })).ok, false);
    });

    test('failureSummary must be a string when present (null is allowed)', () => {
        assert.equal(validateCanonical(withOcc({ failureSummary: null })).ok, true);
        assert.equal(validateCanonical(withOcc({ failureSummary: 42 })).ok, false);
    });

    test('hint must be a string when present (null is allowed)', () => {
        assert.equal(validateCanonical(withOcc({ hint: 'Add a label.' })).ok, true);
        assert.equal(validateCanonical(withOcc({ hint: null })).ok, true);
        assert.equal(validateCanonical(withOcc({ hint: 42 })).ok, false);
    });

    test('uncertainty needs a code, and needed must be a string if given', () => {
        assert.equal(validateCanonical(withOcc({ uncertainty: null })).ok, true);
        assert.equal(validateCanonical(withOcc({ uncertainty: { code: 'not-computable' } })).ok, true);
        assert.equal(validateCanonical(withOcc({ uncertainty: { code: 'not-computable', needed: 'Check it by hand.' } })).ok, true);
        assert.equal(validateCanonical(withOcc({ uncertainty: { needed: 'Check it by hand.' } })).ok, false);
        assert.equal(validateCanonical(withOcc({ uncertainty: { code: 'not-computable', needed: 3 } })).ok, false);
        assert.equal(validateCanonical(withOcc({ uncertainty: 'not-computable' })).ok, false);
    });

    test('evidence must be an object when present (null is allowed)', () => {
        assert.equal(validateCanonical(withOcc({ evidence: null })).ok, true);
        assert.equal(validateCanonical(withOcc({ evidence: 'nope' })).ok, false);
        assert.equal(validateCanonical(withOcc({ evidence: [] })).ok, false); // arrays are not plain objects here
    });

    test('multiple occurrence errors on the same finding all get distinct, correctly-indexed paths', () => {
        const res = validateCanonical({
            findings: [{
                uid: 'a', outcome: 'fail',
                occurrences: [{ html: 42 }, { pageUrl: 42 }]
            }]
        });
        assert.equal(res.errors.length, 2);
        assert.deepEqual(errorPaths(res), [
            'canonical.findings[0].occurrences[0].html',
            'canonical.findings[0].occurrences[1].pageUrl'
        ]);
    });
});

describe('validateCanonicalOrThrow', () => {
    test('returns true for a valid canonical result', () => {
        assert.equal(validateCanonicalOrThrow({ findings: [{ uid: 'a', outcome: 'fail' }] }), true);
    });

    test('throws a named CanonicalValidationError with .details on an invalid result', () => {
        assert.throws(
            () => validateCanonicalOrThrow({ findings: [{ outcome: 'bogus' }] }),
            (err) => {
                assert.equal(err.name, 'CanonicalValidationError');
                assert.ok(Array.isArray(err.details) && err.details.length > 0);
                return true;
            }
        );
    });

    test('the thrown message includes engine id/version from meta when provided', () => {
        assert.throws(
            () => validateCanonicalOrThrow({ findings: 'nope' }, { engineId: 'axe', engineVersion: '4.8.0' }),
            /engine=axe, version=4\.8\.0/
        );
    });

    test('the thrown message has no engine prefix when meta is omitted', () => {
        assert.throws(
            () => validateCanonicalOrThrow({ findings: 'nope' }),
            (err) => {
                assert.ok(err.message.startsWith('[canonical validation failed]'));
                return true;
            }
        );
    });

    test('the thrown message truncates past 20 errors and notes how many more', () => {
        const findings = Array.from({ length: 25 }, (_, i) => ({ uid: `f${i}`, outcome: 'bogus' }));
        assert.throws(
            () => validateCanonicalOrThrow({ findings }),
            (err) => {
                assert.equal(err.details.length, 25);
                assert.match(err.message, /\.\.\.and 5 more\./);
                return true;
            }
        );
    });
});
