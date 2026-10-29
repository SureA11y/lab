'use strict';

// surea11y-scan.js runs core's scan through @surea11y/puppeteer: these check
// that core gets what the lab resolved, as runa11yCoreInPage takes it, said
// through the binding's public setters.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { scanPage, captureScreenshots } = require('./surea11y-scan');
const { TIME_LIMIT_ERROR } = require('../element-screenshots');

// What crosses page.evaluate(): JSON, so a key the builder leaves undefined
// is not there.
const sent = (value) => JSON.parse(JSON.stringify(value));

/**
 * A page that records each evaluate and answers with `answer`. The binding
 * first asks the page which style sheets it can't read
 * (findUnreadableStyleSheets): this page has none, and that question is not
 * one of the calls.
 */
function fakePage({ answer = { checksResults: [], rulesResults: [] }, url = () => 'https://example.test/' } = {}) {
    const calls = [];
    const page = {
        calls,
        urlCalls: 0,
        url() { page.urlCalls += 1; return url(); },
        evaluate: async (fn, ...args) => {
            if (fn && fn.name === 'findUnreadableStyleSheets') return [];
            calls.push({ fn, args });
            return typeof answer === 'function' ? answer(...args) : answer;
        },
    };
    return page;
}

describe('surea11y-scan', () => {
    test('hands core the URL, scope, engine options and runOnly in runa11yCoreInPage\'s order', async () => {
        const page = fakePage();
        const engineOptions = { locale: 'fr', excludeSelectors: ['.ad'], profile: 'en301549-v3.2.1' };
        const runOnly = {
            wcag: { version: '2.2', level: 'AA' },
            bestPractices: true,
            tags: ['forms'],
            excludeTags: [],
            includeRuleIds: [],
            excludeRuleIds: ['image-alt'],
        };
        await scanPage(page, { pageUrl: 'https://example.test/a', contextSelector: '#main', engineOptions, runOnly });

        assert.equal(page.calls.length, 1);
        // The setters leave the empty lists out, which core reads the same.
        assert.deepEqual(sent(page.calls[0].args), ['https://example.test/a', '#main', engineOptions, {
            wcag: { version: '2.2', level: 'AA' },
            bestPractices: true,
            tags: ['forms'],
            excludeRuleIds: ['image-alt'],
        }]);
        assert.notEqual(page.calls[0].args[2], engineOptions, 'a copy: the caller\'s options are not shared with the page');
    });

    test('says includeMode, beside rule ids and tags', async () => {
        const page = fakePage();
        const runOnly = { includeMode: 'or', tags: ['wcag2a', 'best-practice'], includeRuleIds: ['region'] };
        await scanPage(page, { pageUrl: 'https://example.test/', runOnly });
        assert.deepEqual(sent(page.calls[0].args[3]), runOnly);
    });

    test('an invalid WCAG target rejects with INVALID_RUN_ONLY before anything reaches the page', async () => {
        const page = fakePage();
        await assert.rejects(
            scanPage(page, { pageUrl: 'https://example.test/', runOnly: { wcag: { version: '', level: 'AA' } } }),
            (err) => err.code === 'INVALID_RUN_ONLY'
        );
        assert.equal(page.calls.length, 0);
    });

    test('prints nothing for a scope that matched nothing: the lab shows a notice instead', async (t) => {
        const warn = t.mock.method(console, 'warn', () => {});
        const page = fakePage({ answer: { url: 'https://example.test/', checksResults: [], rulesResults: [], contextMatch: { elementCount: 0, unmatchedSelectors: ['#nope'] } } });
        await scanPage(page, { pageUrl: 'https://example.test/', contextSelector: '#nope' });
        assert.equal(warn.mock.callCount(), 0);
    });

    test('screenshots: off unless asked; when asked, every occurrence considered says what was pictured', async () => {
        const answer = () => ({
            url: 'https://example.test/',
            rulesResults: [],
            checksResults: [{ ruleId: 'page-title-present', outcome: 'fail', occurrences: [{ selector: '', summary: 'No title.' }] }],
        });
        const plain = await scanPage(fakePage({ answer }), { pageUrl: 'https://example.test/' });
        assert.ok(!('screenshot' in plain.checksResults[0].occurrences[0]));

        const shot = await scanPage(fakePage({ answer }), { pageUrl: 'https://example.test/', screenshots: { outcomes: ['fail'] } });
        assert.deepEqual(shot.checksResults[0].occurrences[0].screenshot, { skipped: 'no-element' });
    });

    describe('screenshots: their own time', () => {
        const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
        const scanResult = {
            url: 'https://example.test/',
            rulesResults: [],
            checksResults: [{
                ruleId: 'img-alt-present',
                outcome: 'fail',
                occurrences: [
                    { selector: '#a', summary: 'No alt.' },
                    { selector: '#b', summary: 'No alt.' },
                    { selector: '#c', summary: 'No alt.' },
                ],
            }],
        };
        const rect = { x: 10, y: 10, width: 40, height: 20 };
        const view = {
            rect, viewport: { x: 0, y: 0, width: 800, height: 600 },
            window: { width: 800, height: 600 }, scroll: { x: 0, y: 0 }, devicePixelRatio: 1,
        };

        /** A page whose in-page steps answer as a real one would, and whose pictures take `shotMs`. */
        function shootingPage({ shotMs = 0, onShot = () => {} } = {}) {
            const page = fakePage({
                answer: (first) => {
                    if (!first || typeof first !== 'object') return structuredClone(scanResult);
                    page.ops.push(first.op + (first.selector ? ' ' + first.selector : ''));
                    if (first.op === 'frame-key') return { key: 'top' };
                    if (first.op === 'target') return view;
                    return {};
                },
            });
            page.ops = [];
            page.screenshot = async () => {
                onShot();
                await new Promise((resolve) => setTimeout(resolve, shotMs));
                return PNG;
            };
            return page;
        }

        const shots = (result) => result.checksResults[0].occurrences.map((o) => o.screenshot);

        test('past budgetMs no further picture starts, and the page is still put back', async () => {
            const page = shootingPage({ shotMs: 30 });
            const result = await scanPage(page, {
                pageUrl: 'https://example.test/',
                screenshots: { outcomes: ['fail'], padding: 16, budgetMs: 10 },
            });
            const [first, second, third] = shots(result);
            assert.ok(Buffer.isBuffer(first.buffer), 'the picture started in time is kept');
            assert.deepEqual(second, { skipped: 'capture-failed', error: TIME_LIMIT_ERROR });
            assert.deepEqual(third, { skipped: 'capture-failed', error: TIME_LIMIT_ERROR });
            assert.deepEqual(page.ops.filter((op) => op.startsWith('target')), ['target #a'], 'no element is looked for after the deadline');
            assert.equal(page.ops.filter((op) => op === 'release').length, 3, 'every element is put back');
        });

        test('an abort stops the pictures the same way; aborted before they start, none are tried', async () => {
            const abort = new AbortController();
            const page = shootingPage({ onShot: () => abort.abort() });
            const result = await scanPage(page, {
                pageUrl: 'https://example.test/',
                screenshots: { outcomes: ['fail'], signal: abort.signal },
            });
            assert.ok(Buffer.isBuffer(shots(result)[0].buffer));
            assert.deepEqual(shots(result).slice(1), [1, 2].map(() => ({ skipped: 'capture-failed', error: TIME_LIMIT_ERROR })));

            const early = new AbortController();
            early.abort();
            const untouched = shootingPage();
            const none = await scanPage(untouched, { pageUrl: 'https://example.test/', screenshots: { outcomes: ['fail'], signal: early.signal } });
            assert.deepEqual(untouched.ops, []);
            assert.deepEqual(shots(none), [undefined, undefined, undefined]);
        });

        test('captureScreenshots() pictures a finished scan\'s result the same way, and takes none without options', async () => {
            const page = shootingPage();
            const result = await scanPage(page, { pageUrl: 'https://example.test/' });
            assert.deepEqual(page.ops, [], 'the scan alone takes no pictures');

            assert.equal(await captureScreenshots(page, result, null), result);
            assert.deepEqual(page.ops, []);

            const same = await captureScreenshots(page, result, { outcomes: ['fail'], padding: 16, budgetMs: 60000 });
            assert.equal(same, result, 'in place');
            assert.ok(shots(result).every((s) => Buffer.isBuffer(s.buffer)));
            assert.deepEqual(page.ops.filter((op) => op.startsWith('target')), ['target #a', 'target #b', 'target #c']);
        });

        test('perRule pictures at most that many elements of each check, sharing an element\'s picture across checks', async () => {
            const result = {
                url: 'https://example.test/',
                rulesResults: [],
                checksResults: [
                    { ruleId: 'img-alt-present', outcome: 'fail', occurrences: ['#a', '#b', '#c'].map((selector) => ({ selector })) },
                    { ruleId: 'link-name', outcome: 'fail', occurrences: ['#c', '#d'].map((selector) => ({ selector })) },
                    { ruleId: 'page-title-present', outcome: 'fail', occurrences: [{ selector: '' }] },
                    { ruleId: 'region', outcome: 'pass', occurrences: ['#e', '#f'].map((selector) => ({ selector })) },
                ],
            };
            const page = shootingPage();
            await captureScreenshots(page, result, { outcomes: ['fail'], padding: 16, perRule: 1 });

            assert.deepEqual(page.ops.filter((op) => op.startsWith('target')), ['target #a', 'target #c'], 'the first element of each check, once');
            const [imgs, links, title, region] = result.checksResults.map((c) => c.occurrences.map((o) => o.screenshot));
            assert.ok(Buffer.isBuffer(imgs[0].buffer));
            assert.deepEqual(imgs[1], { skipped: 'rule-limit', max: 1 });
            assert.equal(imgs[2], links[0], '#c, cut from the first check, shows the picture taken for the second');
            assert.deepEqual(links[1], { skipped: 'rule-limit', max: 1 });
            assert.deepEqual(title, [{ skipped: 'no-element' }], 'page-level: nothing to picture, and no limit used');
            assert.deepEqual(region, [undefined, undefined], 'outcomes not pictured are left alone');
        });

        test('budgetMs and signal are the lab\'s: the binding is not handed them', async () => {
            const result = await scanPage(shootingPage(), {
                pageUrl: 'https://example.test/',
                screenshots: { outcomes: ['fail'], budgetMs: 60000, signal: new AbortController().signal },
            });
            assert.ok(shots(result).every((s) => Buffer.isBuffer(s.buffer)));
        });
    });

    test('no selection, no scope: null for both, as before', async () => {
        const page = fakePage();
        await scanPage(page, { pageUrl: 'https://example.test/', engineOptions: { locale: 'en' } });
        assert.deepEqual(sent(page.calls[0].args), ['https://example.test/', null, { locale: 'en' }, null]);
    });

    test('without a URL, core gets none and the page is not asked again', async () => {
        const page = fakePage({ url: () => { throw new Error('no url'); } });
        await scanPage(page, { pageUrl: null });
        assert.equal(page.calls[0].args[0], null);
        assert.equal(page.urlCalls, 0);
    });

    test('returns core\'s result', async () => {
        const result = { url: 'https://example.test/', checksResults: [{ ruleId: 'image-alt', outcome: 'fail' }], rulesResults: [] };
        const page = fakePage({ answer: result });
        assert.deepEqual(await scanPage(page, { pageUrl: 'https://example.test/' }), result);
    });

    test('an engine error comes back with its code', async () => {
        const page = fakePage({
            answer: { __surea11yEngineError: { message: 'contextSelector: "###" is not a valid CSS selector.', code: 'INVALID_CONTEXT_SELECTOR', selector: '###' } },
        });
        await assert.rejects(
            scanPage(page, { pageUrl: 'https://example.test/', contextSelector: '###' }),
            (err) => err.message === 'contextSelector: "###" is not a valid CSS selector.'
                && err.code === 'INVALID_CONTEXT_SELECTOR' && err.selector === '###'
        );
    });
});
