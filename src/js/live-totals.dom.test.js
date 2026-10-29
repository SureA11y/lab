'use strict';

// DOM tests for the floating "scan totals" counter (createLiveTotals), driven
// under jsdom. The counter is created lazily on the first scan, accumulates
// fail / can't tell / pass, total DOM nodes and the scan count, exposes a
// dismiss button that is disabled (with a spinner) while the run is in progress
// and active once it finishes, and is removed on reset() (new run) or when
// dismissed. node's test runner isolates each file in its own process.

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let createLiveTotals;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Node = win.Node;
    globalThis.HTMLElement = win.HTMLElement;

    ({createLiveTotals} = await import('./live-totals.js'));
});

beforeEach(() => {
    document.body.innerHTML = '';
});

function valueText(el, statSelector) {
    return el.querySelector(statSelector).querySelector('.live-totals-value').textContent;
}

describe('createLiveTotals', () => {
    test('is not mounted until the first scan is added', () => {
        createLiveTotals();
        assert.equal(document.getElementById('live-totals'), null);
    });

    test('says the tally from a status that is on the page, empty, before the first scan', async () => {
        const totals = createLiveTotals();
        await Promise.resolve();
        const status = document.getElementById('live-totals-announce');
        assert.ok(status, 'the status is there before any scan');
        assert.equal(status.getAttribute('role'), 'status');
        assert.equal(status.getAttribute('aria-live'), 'polite');
        assert.equal(status.textContent, '');

        totals.add({counts: {violations: 3, incomplete: 2, passes: 10}, domNodes: 1200});
        assert.equal(status.textContent, "3 fail, 2 can't tell, 10 pass, 1 scan");
        totals.finish();
        assert.equal(status.textContent, "3 fail, 2 can't tell, 10 pass, 1 scan, run finished");

        totals.setHidden(true);
        totals.add({counts: {violations: 1}});
        assert.equal(status.textContent, "3 fail, 2 can't tell, 10 pass, 1 scan, run finished", 'quiet on another tab');

        totals.setHidden(false);
        totals.reset();
        assert.equal(status.textContent, '');
    });

    test('creates the counter on the first scan and shows the four totals', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 3, incomplete: 2, passes: 10}, domNodes: 1200});

        const el = document.getElementById('live-totals');
        assert.ok(el, 'counter is mounted');
        assert.equal(el.tagName, 'DIV'); // an aside may not be a status
        assert.equal(el.getAttribute('role'), 'region');
        assert.equal(el.getAttribute('aria-label'), 'Live scan totals');
        assert.equal(el.getAttribute('aria-live'), null, 'the card is not the live region');

        assert.equal(valueText(el, '.live-totals-fail'), '3');
        assert.equal(valueText(el, '.live-totals-cantTell'), '2');
        assert.equal(valueText(el, '.live-totals-pass'), '10');
        assert.equal(el.querySelector('.live-totals-dom .live-totals-value').textContent, '1,200');
    });

    test('title reads "Totals:" and shows the scan count (pluralised)', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 1, incomplete: 0, passes: 0}, domNodes: 1});

        let el = document.getElementById('live-totals');
        assert.match(el.querySelector('.live-totals-title').textContent, /^Totals:/);
        assert.equal(el.querySelector('.live-totals-scans').textContent, '1 scan');

        totals.add({counts: {violations: 0, incomplete: 0, passes: 1}, domNodes: 1});
        el = document.getElementById('live-totals');
        assert.equal(el.querySelector('.live-totals-scans').textContent, '2 scans');
    });

    test('reuses the shared result glyphs for each state', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 1, incomplete: 1, passes: 1}, domNodes: 1});

        const el = document.getElementById('live-totals');
        assert.ok(el.querySelector('.live-totals-fail .result-glyph--fail'), 'fail glyph');
        assert.ok(el.querySelector('.live-totals-cantTell .result-glyph--unknown'), "can't tell glyph");
        assert.ok(el.querySelector('.live-totals-pass .result-glyph--pass'), 'pass glyph');
    });

    test('accumulates totals across scans', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 3, incomplete: 2, passes: 10}, domNodes: 1200});
        totals.add({counts: {violations: 1, incomplete: 0, passes: 5}, domNodes: 800});

        assert.deepEqual(totals.getTotals(), {
            violations: 4, incomplete: 2, passes: 15, domNodes: 2000, scans: 2, scansRun: 2
        });

        const el = document.getElementById('live-totals');
        assert.equal(valueText(el, '.live-totals-fail'), '4');
        assert.equal(valueText(el, '.live-totals-pass'), '15');
        assert.equal(el.querySelector('.live-totals-dom .live-totals-value').textContent, '2,000');
    });

    test('treats missing / non-numeric counts as zero', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 2}});
        totals.add({});

        assert.deepEqual(totals.getTotals(), {
            violations: 2, incomplete: 0, passes: 0, domNodes: 0, scans: 2, scansRun: 2
        });
    });

    test('dismiss button is disabled and shows the spinner while running', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 1, incomplete: 0, passes: 0}, domNodes: 1});

        const el = document.getElementById('live-totals');
        const btn = el.querySelector('.live-totals-dismiss');
        assert.ok(btn, 'dismiss button exists');
        assert.equal(btn.disabled, true);
        assert.ok(el.querySelector('.live-totals-dismiss-spinner.tab-spinner'), 'reuses the shared spinner');
        assert.equal(el.classList.contains('is-finished'), false);
    });

    test('clicking the dismiss button does nothing while running', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 1, incomplete: 0, passes: 0}, domNodes: 1});

        document.getElementById('live-totals').querySelector('.live-totals-dismiss').click();
        assert.ok(document.getElementById('live-totals'), 'still mounted');
    });

    test('finish() enables the dismiss button and swaps in the close icon', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 1, incomplete: 0, passes: 0}, domNodes: 1});
        totals.finish();

        const el = document.getElementById('live-totals');
        const btn = el.querySelector('.live-totals-dismiss');
        assert.equal(btn.disabled, false);
        assert.ok(el.classList.contains('is-finished'), 'is-finished set');
        assert.equal(btn.getAttribute('aria-label'), 'Dismiss scan totals');

        // Once finished, clicking dismisses the counter.
        btn.click();
        assert.equal(document.getElementById('live-totals'), null);
    });

    test('reset() zeroes totals and removes the counter', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 3, incomplete: 2, passes: 10}, domNodes: 1200});
        totals.finish();

        totals.reset();
        assert.equal(document.getElementById('live-totals'), null);
        assert.deepEqual(totals.getTotals(), {
            violations: 0, incomplete: 0, passes: 0, domNodes: 0, scans: 0, scansRun: 0
        });

        // A fresh scan after reset re-creates the counter from zero, back in the
        // running (disabled) state.
        totals.add({counts: {violations: 1, incomplete: 0, passes: 0}, domNodes: 50});
        const el = document.getElementById('live-totals');
        assert.ok(el);
        assert.equal(valueText(el, '.live-totals-fail'), '1');
        assert.equal(el.querySelector('.live-totals-dismiss').disabled, true);
    });

    test('remove() removes the counter but keeps the totals', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 3, incomplete: 2, passes: 10}, domNodes: 1200});

        totals.remove();
        assert.equal(document.getElementById('live-totals'), null);
        assert.deepEqual(totals.getTotals(), {
            violations: 3, incomplete: 2, passes: 10, domNodes: 1200, scans: 1, scansRun: 1
        });
    });

    test('mounts into a custom mount element when provided', () => {
        const host = document.createElement('div');
        host.id = 'host';
        document.body.appendChild(host);

        const totals = createLiveTotals({getMount: () => host});
        totals.add({counts: {violations: 1, incomplete: 0, passes: 0}, domNodes: 10});

        assert.ok(host.querySelector('#live-totals'), 'mounted inside custom host');
    });
});

describe('createLiveTotals — by-tag breakdown', () => {
    function ledgerRows(el) {
        return Array.from(el.querySelectorAll('.live-totals-ledger tbody tr')).map((tr) => ({
            tag: tr.querySelector('.live-totals-ledger-tag').textContent,
            untagged: tr.classList.contains('live-totals-ledger-untagged'),
            fail: tr.querySelector('.live-totals-ledger-fail').textContent,
            cantTell: tr.querySelector('.live-totals-ledger-cantTell').textContent,
            pass: tr.querySelector('.live-totals-ledger-pass').textContent
        }));
    }

    test('the "by tag" block stays hidden until a named tag is seen', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 1, incomplete: 0, passes: 0}, domNodes: 10}); // untagged

        const el = document.getElementById('live-totals');
        assert.equal(el.querySelector('.live-totals-tags').hidden, true, 'hidden with no named tags');

        totals.add({counts: {violations: 2, incomplete: 1, passes: 3}, domNodes: 20, scanTags: ['desktop']});
        const block = el.querySelector('.live-totals-tags');
        assert.equal(block.hidden, false, 'shown once a tag appears');
        assert.equal(block.querySelector('.live-totals-disclosure').hidden, false);
        assert.equal(block.querySelector('.live-totals-tags-note').textContent, '1 tag');

        totals.add({counts: {violations: 1, incomplete: 0, passes: 0}, scanTags: ['mobile']});
        assert.equal(el.querySelector('.live-totals-tags-note').textContent, '2 tags');
    });

    test('accumulates per tag; a multi-tag scan counts toward each tag', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 5, incomplete: 2, passes: 10}, domNodes: 100, scanTags: ['desktop', 'checkout']});
        totals.add({counts: {violations: 3, incomplete: 1, passes: 8}, domNodes: 80, scanTags: ['desktop']});

        const tt = totals.getTagTotals();
        const desktop = tt.find((r) => r.label === 'desktop');
        const checkout = tt.find((r) => r.label === 'checkout');
        assert.deepEqual(
            {v: desktop.violations, i: desktop.incomplete, p: desktop.passes, s: desktop.scans},
            {v: 8, i: 3, p: 18, s: 2}
        );
        assert.deepEqual(
            {v: checkout.violations, i: checkout.incomplete, p: checkout.passes, s: checkout.scans},
            {v: 5, i: 2, p: 10, s: 1}
        );

        // Grand total counts each scan once, even the two-tag one.
        assert.deepEqual(totals.getTotals(), {violations: 8, incomplete: 3, passes: 18, domNodes: 180, scans: 2, scansRun: 2});
    });

    test('from an older runner, with no key: a merged scan swaps its scans for itself, overall and per tag', () => {
        const lt = createLiveTotals();
        lt.add({counts: {violations: 1, incomplete: 0, passes: 3}, scanTags: ['home']});
        lt.add({counts: {violations: 2, incomplete: 1, passes: 3}, scanTags: ['desktop']});
        lt.add({counts: {violations: 2, incomplete: 1, passes: 3}, scanTags: ['mobile']});
        lt.merge({
            removed: [
                {counts: {violations: 2, incomplete: 1, passes: 3}, scanTags: ['desktop']},
                {counts: {violations: 2, incomplete: 1, passes: 3}, scanTags: ['mobile']},
            ],
            added: {counts: {violations: 3, incomplete: 1, passes: 4}, scanTags: ['desktop', 'mobile']},
        });

        assert.deepEqual(lt.getTotals(), {violations: 4, incomplete: 1, passes: 7, domNodes: 0, scans: 2, scansRun: 3});
        const byTag = Object.fromEntries(lt.getTagTotals().map((r) => [r.label, [r.violations, r.scans]]));
        assert.deepEqual(byTag.desktop, [3, 1]);
        assert.deepEqual(byTag.mobile, [3, 1]);
        assert.deepEqual(byTag.home, [1, 1]);
    });

    test('a Merged scan counts once from its first context, and the scans run show beside it', () => {
        const lt = createLiveTotals();
        lt.add({counts: {violations: 1, incomplete: 0, passes: 3}, scanTags: ['home']});
        lt.add({counts: {violations: 2, incomplete: 1, passes: 3}, scanTags: ['desktop'], mergedScanKey: 'merged-1'});
        assert.deepEqual([lt.getTotals().scans, lt.getTotals().scansRun], [2, 2]);
        lt.add({counts: {violations: 2, incomplete: 1, passes: 3}, scanTags: ['mobile'], mergedScanKey: 'merged-1'});
        assert.deepEqual([lt.getTotals().scans, lt.getTotals().scansRun], [2, 3], 'the report count does not rise for a second context');

        const el = document.getElementById('live-totals');
        assert.equal(el.querySelector('.live-totals-scans').textContent, '2 scans (3 before merging)');

        lt.merge({
            key: 'merged-1',
            removed: [
                {counts: {violations: 2, incomplete: 1, passes: 3}, scanTags: ['desktop']},
                {counts: {violations: 2, incomplete: 1, passes: 3}, scanTags: ['mobile']},
            ],
            added: {counts: {violations: 3, incomplete: 1, passes: 4}, scanTags: ['catalog']},
        });
        assert.deepEqual(lt.getTotals(), {violations: 4, incomplete: 1, passes: 7, domNodes: 0, scans: 2, scansRun: 3}, 'nor drops when it folds');
        assert.equal(el.querySelector('.live-totals-scans').textContent, '2 scans (3 before merging)');
        assert.deepEqual(lt.getTagTotals().map((r) => r.label).sort(), ['catalog', 'home']);

        lt.reset();
        lt.add({counts: {violations: 1, incomplete: 0, passes: 0}});
        assert.equal(document.getElementById('live-totals').querySelector('.live-totals-scans').textContent, '1 scan', 'nothing beside it without merging');
    });

    test('folds tag casing variants together, keeping the first-seen casing', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 1, incomplete: 0, passes: 0}, scanTags: ['Desktop']});
        totals.add({counts: {violations: 1, incomplete: 0, passes: 0}, scanTags: ['desktop']});

        const tt = totals.getTagTotals();
        assert.equal(tt.length, 1);
        assert.equal(tt[0].label, 'Desktop');
        assert.equal(tt[0].violations, 2);
    });

    test('ledger is sorted worst-first with Untagged always last', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 1, incomplete: 0, passes: 0}, scanTags: ['low']});
        totals.add({counts: {violations: 9, incomplete: 0, passes: 0}, scanTags: ['high']});
        totals.add({counts: {violations: 4, incomplete: 0, passes: 0}}); // untagged

        const rows = ledgerRows(document.getElementById('live-totals'));
        assert.deepEqual(rows.map((r) => r.tag), ['high', 'low', 'Untagged']);
        assert.equal(rows[2].untagged, true);
        assert.equal(rows[0].fail, '9');
    });

    test('clicking "by tag" expands and collapses the ledger in place', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 1, incomplete: 0, passes: 0}, scanTags: ['desktop']});

        const el = document.getElementById('live-totals');
        const block = el.querySelector('.live-totals-tags');
        const btn = block.querySelector('.live-totals-disclosure');
        const scroll = el.querySelector('.live-totals-tagscroll');
        assert.equal(btn.getAttribute('aria-expanded'), 'false');
        assert.equal(scroll.hidden, true);

        btn.click();
        assert.equal(btn.getAttribute('aria-expanded'), 'true');
        assert.equal(scroll.hidden, false);
        assert.ok(block.classList.contains('is-expanded'));

        btn.click();
        assert.equal(btn.getAttribute('aria-expanded'), 'false');
        assert.equal(scroll.hidden, true);
        assert.equal(block.classList.contains('is-expanded'), false);
    });

    test('the ledger opens below the totals it breaks down, inside the card', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 1, incomplete: 0, passes: 0}, scanTags: ['desktop']});

        const el = document.getElementById('live-totals');
        const panel = el.querySelector('.live-totals-panel');
        const block = el.querySelector('.live-totals-tags');

        assert.equal(block.parentNode, panel, 'the block lives in the card, not floating beside it');

        const children = [...panel.children];
        assert.ok(
            children.indexOf(block) > children.indexOf(el.querySelector('.live-totals-dom')),
            'and sits under the numbers rather than above them'
        );
        assert.ok(
            [...block.children].indexOf(el.querySelector('.live-totals-tagscroll')) >
            [...block.children].indexOf(block.querySelector('.live-totals-tags-foot')),
            'with the table below its own button'
        );
    });

    test('both disclosures are the same control, opening their own table only', () => {
        const totals = createLiveTotals();
        totals.setSteps({
            done: 2, remaining: 3,
            doneByType: {a11yScan: 2}, remainingByType: {a11yScan: 3}
        });
        totals.add({counts: {violations: 1, incomplete: 0, passes: 0}, scanTags: ['desktop']});

        const el = document.getElementById('live-totals');
        const [byType, byTag] = [...el.querySelectorAll('.live-totals-disclosure')];
        assert.equal(byType.textContent.trim(), 'by type');
        assert.equal(byTag.textContent.trim(), 'by tag');

        byTag.click();
        assert.equal(el.querySelector('#live-totals-bystep').hidden, true, 'by type stays shut');
        assert.equal(el.querySelector('.live-totals-tagscroll').hidden, false);
    });

    test('formats large per-tag counts with thousands separators', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 1234, incomplete: 0, passes: 0}, scanTags: ['desktop']});

        const rows = ledgerRows(document.getElementById('live-totals'));
        assert.equal(rows[0].fail, '1,234');
    });

    test('setHidden toggles the counter without discarding totals', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 2, incomplete: 0, passes: 0}, scanTags: ['desktop']});

        const el = document.getElementById('live-totals');
        totals.setHidden(true);
        assert.ok(el.classList.contains('is-tab-hidden'), 'hidden class applied');

        totals.setHidden(false);
        assert.equal(el.classList.contains('is-tab-hidden'), false, 'shown again');
        assert.deepEqual(totals.getTotals(), {violations: 2, incomplete: 0, passes: 0, domNodes: 0, scans: 1, scansRun: 1});
    });

    test('reset() clears the per-tag tallies too', () => {
        const totals = createLiveTotals();
        totals.add({counts: {violations: 1, incomplete: 0, passes: 0}, scanTags: ['desktop']});
        totals.reset();
        assert.deepEqual(totals.getTagTotals(), []);
    });
});

// The step-progress block: fed by the shared step counter. Loops and
// conditions decide at run time how many steps a run takes, so it shows only
// what is known: the steps that ran, the workflow's own (top-level) steps as a
// bar, and the step running now.
describe('createLiveTotals: step progress', () => {
    const snapshot = (over = {}) => ({
        done: 0,
        doneByType: {},
        workflow: {total: 0, done: 0, at: null},
        current: null,
        ...over
    });

    function stepsOf(el) {
        return {
            block: el.querySelector('.live-totals-steps'),
            count: el.querySelector('.live-totals-steps-count').textContent,
            note: el.querySelector('.live-totals-steps-note').textContent,
            now: el.querySelector('.live-totals-steps-now'),
            bar: el.querySelector('.live-totals-bar'),
            fill: el.querySelector('.live-totals-bar-fill'),
            button: el.querySelector('.live-totals-disclosure'),
            table: el.querySelector('.live-totals-detail')
        };
    }

    test('appears from the first step, before any scan, with the steps run and no total', () => {
        const lt = createLiveTotals();
        lt.setSteps(snapshot({workflow: {total: 6, done: 0, at: 1}}));

        const el = document.getElementById('live-totals');
        assert.ok(el, 'the counter is created by step data alone');
        assert.equal(stepsOf(el).block.hidden, false);
        assert.equal(stepsOf(el).count, '0 run');
    });

    test('stays hidden when the workflow has no steps and none ran', () => {
        const lt = createLiveTotals();
        lt.setSteps(snapshot());
        assert.equal(stepsOf(document.getElementById('live-totals')).block.hidden, true);
    });

    test('the bar counts the workflow\'s own steps, whatever ran inside them', () => {
        const lt = createLiveTotals();
        lt.setSteps(snapshot({done: 128, workflow: {total: 8, done: 4, at: 5}}));

        const s = stepsOf(document.getElementById('live-totals'));
        assert.equal(s.count, '128 run');
        assert.equal(s.note, 'Workflow step 5 of 8');
        assert.equal(s.fill.style.width, '50%');
        assert.equal(s.bar.classList.contains('is-segmented'), true);
        assert.equal(s.bar.style.getPropertyValue('--segments'), '8');
    });

    test('the bar announces itself in words, the same as its note', () => {
        const lt = createLiveTotals();
        lt.setSteps(snapshot({done: 9, workflow: {total: 8, done: 4, at: 5}}));

        const bar = stepsOf(document.getElementById('live-totals')).bar;
        assert.equal(bar.getAttribute('role'), 'progressbar');
        assert.equal(bar.getAttribute('aria-label'), 'Steps');
        assert.equal(bar.getAttribute('aria-valuenow'), '4');
        assert.equal(bar.getAttribute('aria-valuemax'), '8');
        assert.equal(bar.getAttribute('aria-valuetext'), 'Workflow step 5 of 8');
    });

    test('a long workflow gets a whole track rather than hairline segments', () => {
        const lt = createLiveTotals();
        lt.setSteps(snapshot({done: 3, workflow: {total: 31, done: 3, at: 4}}));
        assert.equal(stepsOf(document.getElementById('live-totals')).bar.classList.contains('is-segmented'), false);
    });

    test('every workflow step done fills the bar and says so', () => {
        const lt = createLiveTotals();
        lt.setSteps(snapshot({done: 40, workflow: {total: 7, done: 7, at: 7}}));

        const s = stepsOf(document.getElementById('live-totals'));
        assert.equal(s.note, 'All 7 workflow steps done');
        assert.equal(s.fill.style.width, '100%');
        assert.equal(s.bar.classList.contains('is-complete'), true);
    });

    test('a run that stopped early says how many workflow steps finished', () => {
        const lt = createLiveTotals();
        lt.setSteps(snapshot({done: 12, workflow: {total: 7, done: 3, at: 4}}));
        lt.finish();

        const s = stepsOf(document.getElementById('live-totals'));
        assert.equal(s.note, '3 of 7 workflow steps done');
        assert.equal(s.bar.classList.contains('is-complete'), false);
    });

    describe('the "Now" line', () => {
        test('names the step running by its label, and the loop item it is on', () => {
            const lt = createLiveTotals();
            lt.setSteps(snapshot({
                done: 20,
                workflow: {total: 3, done: 1, at: 2},
                current: {actionPath: '2.3', type: 'click', label: 'Next page', loop: {index: 11, total: 40}}
            }));
            const now = stepsOf(document.getElementById('live-totals')).now;
            assert.equal(now.hidden, false);
            assert.equal(now.textContent, 'Now: Next page · item 12 of 40');
            assert.equal(now.title, 'Next page · item 12 of 40');
        });

        test('falls back to the type, and leaves out the loop\'s size while it is unknown', () => {
            const lt = createLiveTotals();
            lt.setSteps(snapshot({
                done: 2,
                workflow: {total: 3, done: 1, at: 2},
                current: {actionPath: '2.1', type: 'a11yScan', label: null, loop: {index: 0, total: null}}
            }));
            assert.equal(stepsOf(document.getElementById('live-totals')).now.textContent, 'Now: a11yScan · item 1');
        });

        test('outside a loop it is just the step', () => {
            const lt = createLiveTotals();
            lt.setSteps(snapshot({
                done: 0,
                workflow: {total: 3, done: 0, at: 1},
                current: {actionPath: '1', type: 'navigate', label: null, loop: null}
            }));
            assert.equal(stepsOf(document.getElementById('live-totals')).now.textContent, 'Now: navigate');
        });

        test('goes once the run has finished', () => {
            const lt = createLiveTotals();
            lt.setSteps(snapshot({
                done: 3,
                workflow: {total: 3, done: 3, at: 3},
                current: {actionPath: '3', type: 'a11yScan', label: null, loop: null}
            }));
            lt.finish();
            assert.equal(stepsOf(document.getElementById('live-totals')).now.hidden, true);
        });
    });

    describe('the by-type table', () => {
        const withTypes = () => snapshot({
            done: 6,
            workflow: {total: 4, done: 2, at: 3},
            doneByType: {a11yScan: 2, click: 3, navigate: 1}
        });

        test('is collapsed until asked for', () => {
            const lt = createLiveTotals();
            lt.setSteps(withTypes());

            const s = stepsOf(document.getElementById('live-totals'));
            assert.equal(s.table.hidden, true);
            assert.equal(s.button.hidden, false);
            assert.equal(s.button.getAttribute('aria-expanded'), 'false');
        });

        test('opens on click and lists how many of each type ran, the busiest first', () => {
            const lt = createLiveTotals();
            lt.setSteps(withTypes());

            const el = document.getElementById('live-totals');
            stepsOf(el).button.click();

            const s = stepsOf(el);
            assert.equal(s.table.hidden, false);
            assert.equal(s.button.getAttribute('aria-expanded'), 'true');

            const head = [...s.table.querySelectorAll('thead th')].map((th) => th.textContent);
            assert.deepEqual(head, ['Step', 'run']);
            const rows = [...s.table.querySelectorAll('tbody tr')].map((tr) => [
                tr.querySelector('th').textContent,
                ...[...tr.querySelectorAll('td')].map((td) => td.textContent)
            ]);
            assert.deepEqual(rows, [
                ['click', '3'],
                ['a11yScan', '2'],
                ['navigate', '1']
            ]);
        });

        test('the button stays hidden when no step has run yet', () => {
            const lt = createLiveTotals();
            lt.setSteps(snapshot({workflow: {total: 2, done: 0, at: 1}}));
            assert.equal(stepsOf(document.getElementById('live-totals')).button.hidden, true);
        });

        test('it stays open across updates, so a live run does not slam it shut', () => {
            const lt = createLiveTotals();
            lt.setSteps(withTypes());
            const el = document.getElementById('live-totals');
            stepsOf(el).button.click();

            lt.setSteps(snapshot({
                done: 8,
                workflow: {total: 4, done: 2, at: 3},
                doneByType: {a11yScan: 2, click: 5, navigate: 1}
            }));

            assert.equal(stepsOf(el).table.hidden, false);
            assert.equal(el.querySelector('.live-totals-detail tbody tr td').textContent, '5');
        });
    });

    test('a new run clears the step progress along with the totals', () => {
        const lt = createLiveTotals();
        lt.setSteps(snapshot({done: 5, workflow: {total: 5, done: 2, at: 3}}));
        lt.reset();

        assert.equal(document.getElementById('live-totals'), null);
        assert.equal(lt.getSteps(), null);
    });

    test('scan totals and step progress share the panel without disturbing each other', () => {
        const lt = createLiveTotals();
        lt.setSteps(snapshot({done: 2, workflow: {total: 5, done: 2, at: 3}}));
        lt.add({counts: {violations: 4, incomplete: 1, passes: 7}, domNodes: 900});

        const el = document.getElementById('live-totals');
        assert.equal(valueText(el, '.live-totals-fail'), '4');
        assert.equal(stepsOf(el).count, '2 run');
    });

    test('inline: part of the content it is mounted in, with no dismiss button and its own ids', () => {
        const mount = document.createElement('div');
        document.body.append(mount);
        const floating = createLiveTotals();
        floating.add({counts: {violations: 1}, scanTags: ['home']});
        const inline = createLiveTotals({getMount: () => mount, inline: true, idPrefix: 'watch-1-totals'});
        inline.add({counts: {violations: 2, incomplete: 0, passes: 5}, domNodes: 40, scanTags: ['home']});
        inline.setSteps({done: 1, doneByType: {a11yScan: 1}, workflow: {total: 2, done: 1, at: 2}, current: null});

        const el = mount.firstElementChild;
        assert.equal(el.id, 'watch-1-totals');
        assert.equal(el.tagName, 'DIV');
        assert.ok(el.classList.contains('live-totals--inline'));
        assert.equal(el.getAttribute('role'), 'region');
        assert.equal(el.querySelector('.live-totals-dismiss'), null);
        assert.ok(el.querySelector('#watch-1-totals-bytag'));
        assert.ok(el.querySelector('#watch-1-totals-bystep'));
        assert.equal(document.querySelectorAll('#live-totals-bytag').length, 1, 'the floating counter keeps its ids');

        inline.finish();
        assert.ok(el.classList.contains('is-finished'));
    });
});
