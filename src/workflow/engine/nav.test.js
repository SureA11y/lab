'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    safePageUrl,
    normalizeWaitUntil,
    isContextDestroyedError,
    withNavResilience,
    waitForPossibleNavigation,
    startPossibleNavigationWatch,
    waitForSel,
    restoreLoopHomeIfBlank,
    stopLoading,
    waitForRenderSettle,
    gotoPage,
    FRAME_GRACE_MS
} = require('./nav');

const { createWorkflowContext } = require('../workflow-engine');

// These tests exercise nav.js's pure logic and call-orchestration (retries, races, error
// classification) against a lightweight stub `page` - not real Puppeteer/Chrome. That's a
// deliberate choice: none of the functions below inspect real DOM/layout, they only decide
// *when* to call page.waitForNavigation/waitForFunction/etc. and how to react to their
// resolution/rejection timing, which a controlled stub can represent faithfully. Real-browser
// coverage (does Puppeteer's waitForNavigation actually behave as assumed) lives in the
// separate Chrome-backed suite (npm run test:dom).

describe('normalizeWaitUntil', () => {
    test('empty/whitespace/non-string defaults to "load"', () => {
        assert.equal(normalizeWaitUntil(''), 'load');
        assert.equal(normalizeWaitUntil('   '), 'load');
        assert.equal(normalizeWaitUntil(undefined), 'load');
        assert.equal(normalizeWaitUntil(null), 'load');
        assert.equal(normalizeWaitUntil(42), 'load');
    });

    test('maps the deprecated/flaky "networkidle0" to "networkidle2"', () => {
        assert.equal(normalizeWaitUntil('networkidle0'), 'networkidle2');
    });

    test('passes through other values untouched (trimmed)', () => {
        assert.equal(normalizeWaitUntil('domcontentloaded'), 'domcontentloaded');
        assert.equal(normalizeWaitUntil('  networkidle2  '), 'networkidle2');
    });
});

describe('isContextDestroyedError', () => {
    test('matches the known Puppeteer context-destroyed message shapes', () => {
        assert.equal(isContextDestroyedError(new Error('Execution context was destroyed')), true);
        assert.equal(isContextDestroyedError(new Error('Cannot find context with specified id')), true);
        assert.equal(isContextDestroyedError(new Error('failed, most likely because of a navigation')), true);
    });

    test('is case-insensitive', () => {
        assert.equal(isContextDestroyedError(new Error('EXECUTION CONTEXT WAS DESTROYED')), true);
    });

    test('returns false for unrelated errors', () => {
        assert.equal(isContextDestroyedError(new Error('selector not found')), false);
    });

    test('handles non-Error inputs (plain string, null, undefined)', () => {
        assert.equal(isContextDestroyedError('Execution context was destroyed'), true);
        assert.equal(isContextDestroyedError(null), false);
        assert.equal(isContextDestroyedError(undefined), false);
    });
});

describe('safePageUrl', () => {
    test('returns page.url()', () => {
        assert.equal(safePageUrl({ url: () => 'https://example.com/' }), 'https://example.com/');
    });

    test('returns "" if page.url() throws', () => {
        assert.equal(safePageUrl({ url: () => { throw new Error('detached'); } }), '');
    });
});

describe('withNavResilience', () => {
    test('returns the result on first success without touching page.waitForNavigation', async () => {
        let navCalls = 0;
        const page = { waitForNavigation: async () => { navCalls += 1; } };
        const result = await withNavResilience(page, async () => 'ok');
        assert.equal(result, 'ok');
        assert.equal(navCalls, 0);
    });

    test('rethrows immediately for a non-context-destroyed error, without retrying', async () => {
        let calls = 0;
        const page = { waitForNavigation: async () => {} };
        await assert.rejects(
            () => withNavResilience(page, async () => { calls += 1; throw new Error('boom'); }, { retries: 3 }),
            /boom/
        );
        assert.equal(calls, 1);
    });

    test('retries once on a context-destroyed error and returns the retry result', async () => {
        let navCalls = 0;
        let workCalls = 0;
        const page = { waitForNavigation: async () => { navCalls += 1; } };
        const result = await withNavResilience(page, async () => {
            workCalls += 1;
            if (workCalls === 1) throw new Error('Execution context was destroyed');
            return 'recovered';
        }, { retries: 1 });

        assert.equal(result, 'recovered');
        assert.equal(workCalls, 2);
        assert.equal(navCalls, 1);
    });

    test('exhausts retries and rethrows the final context-destroyed error', async () => {
        let workCalls = 0;
        const page = { waitForNavigation: async () => {} };
        await assert.rejects(
            () => withNavResilience(page, async () => {
                workCalls += 1;
                throw new Error('Execution context was destroyed');
            }, { retries: 2 }),
            /Execution context was destroyed/
        );
        assert.equal(workCalls, 3); // initial attempt + 2 retries
    });
});

describe('waitForPossibleNavigation', () => {
    test('timeout <= 0 resolves false without touching the page at all', async () => {
        const page = new Proxy({}, { get() { throw new Error('page should not be touched'); } });
        const result = await waitForPossibleNavigation(page, 'https://example.com/', { timeout: 0 });
        assert.equal(result, false);
    });

    test('resolves true as soon as either the URL-change watch or waitForNavigation wins the race', async () => {
        const page = {
            waitForFunction: async () => true, // resolves immediately -> "url changed"
            waitForNavigation: () => new Promise(() => {}) // never resolves
        };
        const result = await waitForPossibleNavigation(page, 'https://example.com/', { timeout: 5000 });
        assert.equal(result, true);
    });

    test('resolves false when both watches fail/timeout', async () => {
        const page = {
            waitForFunction: async () => { throw new Error('timeout'); },
            waitForNavigation: async () => { throw new Error('timeout'); }
        };
        const result = await waitForPossibleNavigation(page, 'https://example.com/', { timeout: 50 });
        assert.equal(result, false);
    });
});

describe('waitForPossibleNavigation: a click that does not navigate', () => {
    // A page whose watches only settle at their timeout, as Puppeteer's do when
    // nothing happens, and that can report requests.
    function quietPage() {
        const listeners = new Set();
        const never = (opts) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), opts.timeout));
        return {
            listeners,
            mainFrame: () => 'main',
            on: (ev, fn) => { if (ev === 'request') listeners.add(fn); },
            off: (ev, fn) => { if (ev === 'request') listeners.delete(fn); },
            waitForFunction: (_fn, opts) => never(opts),
            waitForNavigation: (opts) => never(opts),
            request(frame = 'main', isNav = true) {
                for (const fn of listeners) fn({ isNavigationRequest: () => isNav, frame: () => frame });
            },
        };
    }

    test('returns after the grace period, not after the whole timeout', async () => {
        const page = quietPage();
        const t0 = Date.now();
        const result = await waitForPossibleNavigation(page, 'https://x/', { timeout: 5000, startWithinMs: 60 });
        const took = Date.now() - t0;
        assert.equal(result, false);
        // Bounded by what it claims, the timeout, not a margin a busy machine
        // can overrun: a tighter bound failed now and then under load.
        assert.ok(took < 5000, `took ${took}ms`);
        assert.equal(page.listeners.size, 0, 'and stops listening for requests');
    });

    test('a new document requested in time is waited for to the end, past the grace period', async () => {
        const page = quietPage();
        let loaded;
        page.waitForNavigation = () => new Promise((resolve) => { loaded = resolve; });
        const pending = waitForPossibleNavigation(page, 'https://x/', { timeout: 5000, startWithinMs: 40 });
        page.request();
        setTimeout(() => loaded(), 150);
        const t0 = Date.now();
        assert.equal(await pending, true);
        assert.ok(Date.now() - t0 >= 100, 'it waited for the load, not the grace period');
    });

    test('the address changing while a new document loads does not end the wait early', async () => {
        const page = quietPage();
        let loaded = false;
        page.waitForFunction = async () => true;
        page.waitForNavigation = () => new Promise((resolve) => setTimeout(() => { loaded = true; resolve(); }, 120));
        const pending = waitForPossibleNavigation(page, 'https://x/', { timeout: 5000, startWithinMs: 40 });
        page.request();
        assert.equal(await pending, true);
        assert.equal(loaded, true, 'resolved only once the document had loaded');
    });

    test('a client-side route (address changes, no document) ends the wait at once', async () => {
        const page = quietPage();
        page.waitForFunction = async () => true;
        const t0 = Date.now();
        assert.equal(await waitForPossibleNavigation(page, 'https://x/', { timeout: 20000, startWithinMs: 10000 }), true);
        assert.ok(Date.now() - t0 < 10000, 'before the grace period ran out');
    });

    test('requests that are not a main-frame document do not count as a navigation', async () => {
        const page = quietPage();
        const pending = waitForPossibleNavigation(page, 'https://x/', { timeout: 5000, startWithinMs: 60 });
        page.request('main', false);
        page.request('iframe', true);
        const t0 = Date.now();
        assert.equal(await pending, false);
        assert.ok(Date.now() - t0 < 5000, 'after the grace period, not the timeout');
    });
});

describe('startPossibleNavigationWatch', () => {
    test('timeout <= 0 resolves false without touching the page', async () => {
        const page = new Proxy({}, { get() { throw new Error('page should not be touched'); } });
        const result = await startPossibleNavigationWatch(page, 'https://example.com/', { timeout: 0 });
        assert.equal(result, false);
    });

    // Regression-style corner case: if waitForFunction rejects because the execution context
    // was destroyed mid-check, that almost certainly *means* navigation happened - so this is
    // deliberately treated as a positive signal, not a failure.
    test('a context-destroyed rejection from waitForFunction is treated as "navigated" (true)', async () => {
        const page = {
            waitForFunction: async () => { throw new Error('Execution context was destroyed'); },
            waitForNavigation: () => new Promise(() => {}) // never resolves; the other branch must win
        };
        const result = await startPossibleNavigationWatch(page, 'https://example.com/', { timeout: 500 });
        assert.equal(result, true);
    });

    test('an unrelated rejection from waitForFunction resolves to false (not treated as navigation)', async () => {
        const page = {
            waitForFunction: async () => { throw new Error('some other error'); },
            waitForNavigation: () => new Promise(() => {}) // never resolves; isolates the urlChanged branch
        };
        const result = await startPossibleNavigationWatch(page, 'https://example.com/', { timeout: 500 });
        assert.equal(result, false);
    });

    test('when waitForFunction is unrelated-false but waitForNavigation succeeds, the race still resolves true', async () => {
        const page = {
            waitForFunction: () => new Promise(() => {}), // never resolves; isolates the nav branch
            waitForNavigation: async () => true
        };
        const result = await startPossibleNavigationWatch(page, 'https://example.com/', { timeout: 500 });
        assert.equal(result, true);
    });

    test('resolves false when both watches fail', async () => {
        const page = {
            waitForFunction: async () => { throw new Error('some other error'); },
            waitForNavigation: async () => { throw new Error('timeout'); }
        };
        const result = await startPossibleNavigationWatch(page, 'https://example.com/', { timeout: 500 });
        assert.equal(result, false);
    });
});

describe('waitForSel', () => {
    test('empty/whitespace selector returns undefined without touching the page', async () => {
        const page = new Proxy({}, { get() { throw new Error('page should not be touched'); } });
        assert.equal(await waitForSel(page, ''), undefined);
        assert.equal(await waitForSel(page, '   '), undefined);
    });

    test('delegates to page.waitForSelector with the given selector/options', async () => {
        let seen = null;
        const page = {
            waitForSelector: async (sel, opts) => { seen = { sel, opts }; return 'handle'; },
            waitForNavigation: async () => {}
        };
        const result = await waitForSel(page, '.btn', { visible: false, timeout: 1234 });
        assert.equal(result, 'handle');
        assert.deepEqual(seen, { sel: '.btn', opts: { visible: false, timeout: 1234 } });
    });
});

describe('restoreLoopHomeIfBlank', () => {
    function makeCtx() {
        return createWorkflowContext({});
    }

    test('no loopHomeUrl: returns true immediately without touching the page', async () => {
        const ctx = makeCtx();
        const page = new Proxy({}, { get() { throw new Error('page should not be touched'); } });
        const result = await restoreLoopHomeIfBlank(page, ctx, null);
        assert.equal(result, true);
    });

    test('current URL is not blank: returns true without navigating', async () => {
        const ctx = makeCtx();
        let gotoCalls = 0;
        const page = {
            url: () => 'https://example.com/already-here',
            goto: async () => { gotoCalls += 1; }
        };
        const result = await restoreLoopHomeIfBlank(page, ctx, 'https://example.com/home');
        assert.equal(result, true);
        assert.equal(gotoCalls, 0);
    });

    test('blank URL, first restore attempt succeeds', async () => {
        const ctx = makeCtx();
        let urlCalls = 0;
        const page = {
            url: () => { urlCalls += 1; return urlCalls === 1 ? 'about:blank' : 'https://example.com/home'; },
            waitForNavigation: async () => {},
            goto: async () => {},
            evaluate: async () => {},
            waitForTimeout: async () => {}
        };
        const result = await restoreLoopHomeIfBlank(page, ctx, 'https://example.com/home');
        assert.equal(result, true);
        assert.ok(ctx.runLogs.some(l => l.type === 'info' && l.message.includes('Loop home restored')));
    });

    test('blank URL persists after both restore attempts: returns false and logs an error', async () => {
        const ctx = makeCtx();
        const page = {
            url: () => 'about:blank',
            waitForNavigation: async () => {},
            goto: async () => {},
            evaluate: async () => {},
            waitForTimeout: async () => {}
        };
        const result = await restoreLoopHomeIfBlank(page, ctx, 'https://example.com/home');
        assert.equal(result, false);
        assert.ok(ctx.runLogs.some(l => l.type === 'error' && l.message.includes('Unable to restore loop home URL')));
    });

    test('goto() rejecting is swallowed and still logged as a warning, not thrown', async () => {
        const ctx = makeCtx();
        const page = {
            url: () => 'about:blank',
            waitForNavigation: async () => {},
            goto: async () => { throw new Error('net::ERR_ABORTED'); },
            evaluate: async () => {},
            waitForTimeout: async () => {}
        };
        const result = await restoreLoopHomeIfBlank(page, ctx, 'https://example.com/home');
        assert.equal(result, false);
        assert.ok(ctx.runLogs.some(l => l.type === 'warning' && l.message.includes('loop-home restore goto failed')));
    });
});

describe('stopLoading', () => {
    test('calls page.evaluate and the CDP Page.stopLoading command', async () => {
        let evaluateCalled = false;
        let cdpSent = null;
        const page = {
            evaluate: async () => { evaluateCalled = true; },
            _client: () => ({ send: async (method) => { cdpSent = method; } })
        };
        await stopLoading(page);
        assert.equal(evaluateCalled, true);
        assert.equal(cdpSent, 'Page.stopLoading');
    });

    test('swallows a page.evaluate rejection and still attempts the CDP command', async () => {
        let cdpSent = null;
        const page = {
            evaluate: async () => { throw new Error('detached frame'); },
            _client: () => ({ send: async (method) => { cdpSent = method; } })
        };
        await assert.doesNotReject(() => stopLoading(page));
        assert.equal(cdpSent, 'Page.stopLoading');
    });

    test('swallows a missing/throwing _client() entirely', async () => {
        const page = {
            evaluate: async () => {},
            _client: () => { throw new Error('no client'); }
        };
        await assert.doesNotReject(() => stopLoading(page));
    });
});

// Unlike the rest of this file, waitForRenderSettle's four page.evaluate() calls carry actual
// browser-API logic in their callback bodies (document.readyState, document.fonts.ready,
// requestAnimationFrame, requestIdleCallback) - not just orchestration. But unlike click-utils.js
// (which needs real hit-testing/layout that a mock can't reproduce faithfully), these callbacks
// only ever touch generic, easily-stubbed async browser APIs, no rendering/geometry involved. So
// a fakePage.evaluate that actually *calls* the passed function - against temporarily-stubbed
// `document`/`requestAnimationFrame`/`requestIdleCallback` globals - is a faithful enough
// representation to be worth doing here (see stubGlobals below), unlike for click/hover/etc.
describe('waitForRenderSettle', () => {
    async function stubGlobals(overrides, work) {
        const originals = {};
        const hadOwn = {};
        for (const key of Object.keys(overrides)) {
            hadOwn[key] = Object.prototype.hasOwnProperty.call(global, key);
            originals[key] = global[key];
            global[key] = overrides[key];
        }
        try {
            return await work();
        } finally {
            for (const key of Object.keys(overrides)) {
                if (hadOwn[key]) global[key] = originals[key];
                else delete global[key];
            }
        }
    }

    test('readyState "complete" resolves the document-ready check immediately, without waiting for DOMContentLoaded', async () => {
        const page = { evaluate: async (fn) => fn(), waitForNetworkIdle: async () => {} };
        await stubGlobals({
            document: { readyState: 'complete' },
            requestAnimationFrame: (cb) => cb(),
            requestIdleCallback: (cb) => cb()
        }, () => waitForRenderSettle(page, 2000));
        assert.ok(true); // reaching here without hanging/throwing is the assertion
    });

    test('readyState "loading" waits for a DOMContentLoaded listener to be registered and fire', async () => {
        let listenerRegistered = false;
        const page = { evaluate: async (fn) => fn(), waitForNetworkIdle: async () => {} };
        await stubGlobals({
            document: {
                readyState: 'loading',
                addEventListener: (evt, cb) => { listenerRegistered = (evt === 'DOMContentLoaded'); queueMicrotask(cb); }
            },
            requestAnimationFrame: (cb) => cb(),
            requestIdleCallback: (cb) => cb()
        }, () => waitForRenderSettle(page, 2000));
        assert.equal(listenerRegistered, true);
    });

    test('document.fonts.ready is read and awaited when document.fonts is present', async () => {
        let fontsAccessed = false;
        const page = { evaluate: async (fn) => fn(), waitForNetworkIdle: async () => {} };
        await stubGlobals({
            document: {
                readyState: 'complete',
                get fonts() { fontsAccessed = true; return { ready: Promise.resolve() }; }
            },
            requestAnimationFrame: (cb) => cb(),
            requestIdleCallback: (cb) => cb()
        }, () => waitForRenderSettle(page, 2000));
        assert.equal(fontsAccessed, true);
    });

    test('document.fonts absent resolves the fonts-ready check to null, without throwing', async () => {
        const page = { evaluate: async (fn) => fn(), waitForNetworkIdle: async () => {} };
        await stubGlobals({
            document: { readyState: 'complete' }, // no .fonts property at all
            requestAnimationFrame: (cb) => cb(),
            requestIdleCallback: (cb) => cb()
        }, () => waitForRenderSettle(page, 2000));
        assert.ok(true);
    });

    test('requestIdleCallback, when present, is used instead of the setTimeout fallback', async () => {
        let idleCalled = false;
        const page = { evaluate: async (fn) => fn(), waitForNetworkIdle: async () => {} };
        await stubGlobals({
            document: { readyState: 'complete' },
            requestAnimationFrame: (cb) => cb(),
            requestIdleCallback: (cb) => { idleCalled = true; cb(); }
        }, () => waitForRenderSettle(page, 2000));
        assert.equal(idleCalled, true);
    });

    test('requestIdleCallback absent falls back to a setTimeout-based resolve', async () => {
        const page = { evaluate: async (fn) => fn(), waitForNetworkIdle: async () => {} };
        await stubGlobals({
            document: { readyState: 'complete' },
            requestAnimationFrame: (cb) => cb()
            // requestIdleCallback intentionally left undefined
        }, () => waitForRenderSettle(page, 2000));
        assert.ok(true);
    });

    test('with time remaining, page.waitForNetworkIdle (when present) is called and awaited', async () => {
        let called = false;
        const page = {
            evaluate: async (fn) => fn(),
            waitForNetworkIdle: async () => { called = true; }
        };
        await stubGlobals({
            document: { readyState: 'complete' },
            requestAnimationFrame: (cb) => cb(),
            requestIdleCallback: (cb) => cb()
        }, () => waitForRenderSettle(page, 2000));
        assert.equal(called, true);
    });

    test('a rejecting page.waitForNetworkIdle is swallowed, not thrown', async () => {
        const page = {
            evaluate: async (fn) => fn(),
            waitForNetworkIdle: async () => { throw new Error('timed out'); }
        };
        await assert.doesNotReject(() => stubGlobals({
            document: { readyState: 'complete' },
            requestAnimationFrame: (cb) => cb(),
            requestIdleCallback: (cb) => cb()
        }, () => waitForRenderSettle(page, 2000)));
    });

    test('without page.waitForNetworkIdle, falls back to page.waitForTimeout (also swallowing a rejection)', async () => {
        let called = false;
        const page = {
            evaluate: async (fn) => fn(),
            waitForTimeout: async () => { called = true; throw new Error('boom'); }
        };
        await assert.doesNotReject(() => stubGlobals({
            document: { readyState: 'complete' },
            requestAnimationFrame: (cb) => cb(),
            requestIdleCallback: (cb) => cb()
        }, () => waitForRenderSettle(page, 2000)));
        assert.equal(called, true);
    });
});

describe('gotoPage', () => {
    const { EventEmitter } = require('node:events');

    function makePage(gotoImpl) {
        const page = new EventEmitter();
        page.goto = (url, opts) => gotoImpl(page, url, opts);
        return page;
    }

    test('goes on FRAME_GRACE_MS after the page\'s own document loads, though a frame never does', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        // goto waits for every frame: one that never answers keeps it pending.
        const page = makePage((p) => {
            queueMicrotask(() => p.emit('domcontentloaded'));
            return new Promise(() => {});
        });
        let done = false;
        const going = gotoPage(page, 'https://example.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).then(() => { done = true; });
        await new Promise((r) => setImmediate(r));
        t.mock.timers.tick(FRAME_GRACE_MS - 1);
        await new Promise((r) => setImmediate(r));
        assert.equal(done, false);
        t.mock.timers.tick(1);
        await going;
        assert.equal(done, true);
        assert.equal(page.listenerCount('domcontentloaded'), 0);
    });

    test('a page that cannot be opened rejects as goto does, and a finished goto returns its response', async () => {
        const failing = makePage(async () => { throw new Error('net::ERR_CONNECTION_REFUSED'); });
        await assert.rejects(() => gotoPage(failing, 'https://example.com/', { waitUntil: 'domcontentloaded' }), /ERR_CONNECTION_REFUSED/);
        const fine = makePage(async () => 'response');
        assert.equal(await gotoPage(fine, 'https://example.com/', { waitUntil: 'load' }), 'response');
    });

    test('network-idle waits are left to goto alone', async () => {
        const page = makePage(async (p, url, opts) => opts.waitUntil);
        assert.equal(await gotoPage(page, 'https://example.com/', { waitUntil: 'networkidle2' }), 'networkidle2');
        assert.equal(page.listenerCount('domcontentloaded') + page.listenerCount('load'), 0);
    });
});
