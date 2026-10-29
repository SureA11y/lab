'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { NO_LIMIT, TIME_LIMIT_ERROR, screenshotOptionsForStep, elementScreenshotOf, storeElementScreenshots } = require('./element-screenshots');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('element-screenshots', () => {
    test('the step option asks the binding for the outcomes it names, or for nothing', () => {
        assert.deepEqual(screenshotOptionsForStep('fail'), { outcomes: ['fail'], padding: 16, max: 50 });
        assert.deepEqual(screenshotOptionsForStep('failCantTell'), { outcomes: ['fail', 'cantTell'], padding: 16, max: 50 });
        for (const off of ['off', null, undefined, '', 'yes', 'constructor']) assert.equal(screenshotOptionsForStep(off), null, String(off));
    });

    test('the step says at most how many pictures, a whole number of 1 or more', () => {
        assert.equal(screenshotOptionsForStep('fail', 5).max, 5);
        assert.equal(screenshotOptionsForStep('fail', '120').max, 120, 'as the step editor saves it, or a resolved {var:...}');
        for (const bad of [-3, 2.5, 'many', '', null, undefined, NaN]) assert.equal(screenshotOptionsForStep('fail', bad).max, 50, String(bad));
        // 0 is no limit: the binding takes a whole number, and the time limit still holds.
        assert.equal(screenshotOptionsForStep('fail', 0).max, NO_LIMIT);
        assert.equal(screenshotOptionsForStep('fail', '0').max, NO_LIMIT);
        assert.equal(screenshotOptionsForStep('off', 5), null);
    });

    test('a per-rule limit is passed when the step sets one of 1 or more; 0 or none sets none', () => {
        assert.equal(screenshotOptionsForStep('fail', 50, 3).perRule, 3);
        assert.equal(screenshotOptionsForStep('fail', 50, '5').perRule, 5);
        for (const none of [0, '0', -1, 1.5, '', null, undefined]) assert.ok(!('perRule' in screenshotOptionsForStep('fail', 50, none)), String(none));
    });

    test('an occurrence keeps the picture and its box, or the reason there is none', () => {
        assert.deepEqual(elementScreenshotOf({ buffer: PNG, box: { x: 1, y: 2, width: 3, height: 4 }, cropped: true }),
            { buffer: PNG, box: { x: 1, y: 2, width: 3, height: 4 }, cropped: true });
        assert.deepEqual(elementScreenshotOf({ skipped: 'capture-failed', error: 'Target closed' }), { skipped: 'capture-failed', error: 'Target closed' });
        assert.deepEqual(elementScreenshotOf({ skipped: 'page-level' }), { skipped: 'page-level' });
        // The scan wrapper stopped it: out of time, not a failed capture.
        assert.deepEqual(elementScreenshotOf({ skipped: 'capture-failed', error: TIME_LIMIT_ERROR }), { skipped: 'time-limit' });
        // The limit it reached travels with it, for the report to name.
        assert.deepEqual(elementScreenshotOf({ skipped: 'max-reached' }, { max: 50 }), { skipped: 'max-reached', max: 50 });
        assert.deepEqual(elementScreenshotOf({ skipped: 'max-reached' }), { skipped: 'max-reached' });
        assert.deepEqual(elementScreenshotOf({ skipped: 'rule-limit', max: 3 }), { skipped: 'rule-limit', max: 3 });
        assert.equal(elementScreenshotOf(undefined), null);
        assert.ok(Buffer.isBuffer(elementScreenshotOf({ buffer: new Uint8Array(PNG), box: null }).buffer));
    });

    test('stores each picture once, puts its URL in place of its bytes, and leaves the rest alone', async () => {
        const shot = { buffer: PNG, box: { x: 16, y: 16, width: 50, height: 20 } };
        const atomic = { ruleId: 'img-alt-present', occurrences: [{ target: ['img'], elementScreenshot: shot }, { target: [], elementScreenshot: { skipped: 'no-element' } }] };
        // A criterion copies the check's occurrences, sharing the picture.
        const composite = { ruleId: 'wcag-1.1.1', occurrences: [{ ...atomic.occurrences[0] }] };
        const canonical = { findings: [atomic, composite], findingsByKind: { atomic: [atomic], composite: [composite] } };
        const saved = [];
        const count = await storeElementScreenshots(canonical, {
            save: async (file) => { saved.push(file); return { publicUrl: `/reports/evidence/run/${file.dir}/${file.filename}` }; },
            dir: 'scans/s1/elements',
        });

        assert.equal(count, 1);
        assert.equal(saved.length, 1);
        assert.match(saved[0].filename, /^element-[0-9a-f]{12}\.png$/);
        const url = `/reports/evidence/run/scans/s1/elements/${saved[0].filename}`;
        assert.deepEqual(atomic.occurrences[0].elementScreenshot, { url, box: shot.box });
        assert.deepEqual(composite.occurrences[0].elementScreenshot, { url, box: shot.box });
        assert.deepEqual(atomic.occurrences[1].elementScreenshot, { skipped: 'no-element' });
        assert.ok(!JSON.stringify(canonical).includes('"buffer"'), 'no image bytes are left in the result');
    });

    test('without a place to store it, a picture stays as a data URL; a store that fails says so', async () => {
        const canonical = { findings: [{ occurrences: [{ elementScreenshot: { buffer: PNG, box: null, cropped: true } }] }] };
        await storeElementScreenshots(canonical);
        assert.deepEqual(canonical.findings[0].occurrences[0].elementScreenshot, { url: `data:image/png;base64,${PNG.toString('base64')}`, box: null, cropped: true });

        const failing = { findings: [{ occurrences: [{ elementScreenshot: { buffer: PNG, box: null } }] }] };
        await storeElementScreenshots(failing, { save: async () => { throw new Error('ENOSPC'); } });
        assert.deepEqual(failing.findings[0].occurrences[0].elementScreenshot, { skipped: 'store-failed', error: 'ENOSPC' });
    });
});
