'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { checkRunRequest, refusal } = require('./run-request-check');
const { validateUrlOrThrow } = require('./workflow-run');

const scan = { type: 'a11yScan', label: 'Home' };
const check = (body, env = {}) => checkRunRequest(body, { validateUrl: validateUrlOrThrow, env });

test('a run that can work passes, with no warning for leaving out type and specVersion, or for dryRun', () => {
    const out = check({ url: 'https://example.com/', actions: [scan], dryRun: true });
    assert.deepEqual(out, { ok: true, errors: [], warnings: [] });
});

test('every reason a run cannot work is given at once', () => {
    const out = check({
        url: 'https://example.com/',
        colorScheme: 'purple',
        viewport: { width: 100000, height: 900 },
        language: '<script>',
        actions: [
            { type: 'a11yScan', label: 'x', profile: 'wcag99-zzz', context: ':::nope((' },
            { type: 'navigate', url: 'file:///etc/passwd' },
            { type: 'wait', ms: -1 },
            { type: 'rmrf' },
        ],
    });
    assert.equal(out.ok, false);
    const all = out.errors.join('\n');
    for (const said of [/colorScheme "purple"/, /larger than a browser window/, /"<script>" is not a language tag/, /"wcag99-zzz" is not a profile/,
        /":::nope\(\(" is not a CSS selector/, /"file:\/\/\/etc\/passwd" is not a web address a run may open/, /ms must be a number/, /"rmrf" is not a step type/]) {
        assert.match(all, said);
    }
});

test('a secret not set in the server\'s environment refuses the run; one set does not', () => {
    const body = { url: 'https://example.com/', actions: [{ type: 'navigate', url: 'https://example.com/' }, scan], vars: {} };
    body.actions.push({ type: 'type', selector: '#p', value: { $env: 'LAB_TEST_SECRET' } });
    const refused = check(body, {});
    assert.match(refused.errors.join('\n'), /\$LAB_TEST_SECRET is not set/);
    const taken = check(body, { LAB_TEST_SECRET: 'x' });
    assert.ok(!taken.errors.some((e) => /LAB_TEST_SECRET/.test(e)), taken.errors.join('\n'));
});

test('a request that is not an object is refused; the refusal lists every problem', () => {
    assert.equal(check([]).ok, false);
    assert.deepEqual(refusal(['a', 'b']), { error: 'The workflow cannot run', details: '2 problems: a; b', problems: ['a', 'b'] });
});
