'use strict';

// DOM tests for the per-scan tag editor in the results view, driven under jsdom.
// The renderer paints read-only chips and an edit button; the button swaps in a
// tag widget seeded from the chips, and Save hands the edited list to the host
// via onEditScanTags. node's test runner isolates each file in its own process.

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let createRenderer;
let resultsEl;
let screenshotsEl;
let edits;
let suggestionPool;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Node = win.Node;
    globalThis.HTMLElement = win.HTMLElement;
    globalThis.CSS = win.CSS;
    globalThis.requestAnimationFrame = (fn) => win.setTimeout(fn, 0);

    ({createRenderer} = await import('./a11y-ui.rendering.js'));
});

beforeEach(() => {
    document.body.innerHTML = '<div id="results"></div><div id="shots"></div>';
    resultsEl = document.getElementById('results');
    screenshotsEl = document.getElementById('shots');
    edits = [];
    suggestionPool = [];
});

function makeRenderer(overrides = {}) {
    return createRenderer({
        resultsEl,
        screenshotsEl,
        escapeAttr: (s) => String(s),
        escapeHtml: (s) => String(s),
        jsonToBrowserLink: () => '',
        buildScreenshotElements: () => [],
        imgToBtn: () => document.createElement('img'),
        dialogs: {screenshotsDialog: {openById() {}}},
        onEditScanTags: (scanId, tags) => edits.push({scanId, tags}),
        getScanTagSuggestions: () => suggestionPool,
        ...overrides,
    });
}

// A skipped scan renders the same header, tags and controls as a full one
// without needing findings, metrics or screenshot fixtures.
function scan(id, scanTags, label = null) {
    return {id, label, scanTags, skipped: true, skipInfo: {reason: 'test'}};
}

function render(scans, overrides) {
    makeRenderer(overrides).renderAllScans(scans);
}

const regionFor = (id) => resultsEl.querySelector(`.scan-tags-region[data-scan-id="${id}"]`);
const chipsFor = (id) => Array.from(regionFor(id).querySelectorAll('.scan-tags-display .scan-tag'))
    .map((el) => el.textContent.trim());
const editBtnFor = (id) => resultsEl.querySelector(`.scan-tags-editbtn[data-scan-id="${id}"]`);
const editorFor = (id) => regionFor(id).querySelector('.scan-tags-edit');
const widgetChips = (id) => Array.from(editorFor(id).querySelectorAll('.tag-input__chips .scan-tag'))
    .map((el) => el.textContent.replace('×', '').trim());

function click(el) {
    el.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}));
}

function typeInto(input, value) {
    input.value = value;
    input.dispatchEvent(new window.Event('input', {bubbles: true}));
}

function pressKey(el, key) {
    el.dispatchEvent(new window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
}

describe('scan tag editor', () => {
    test('renders read-only chips for a tagged scan', () => {
        render([scan('s1', ['desktop', 'checkout'])]);
        assert.deepEqual(chipsFor('s1'), ['desktop', 'checkout']);
    });

    test('renders an empty chips area for an untagged scan, still offering the edit button', () => {
        render([scan('s1', null)]);
        assert.deepEqual(chipsFor('s1'), []);
        assert.ok(editBtnFor('s1'));
        assert.equal(editBtnFor('s1').disabled, false);
    });

    test('the editor is hidden until the edit button is pressed', () => {
        render([scan('s1', ['desktop'])]);
        assert.equal(editorFor('s1').hidden, true);
        assert.equal(editBtnFor('s1').getAttribute('aria-expanded'), 'false');

        click(editBtnFor('s1'));

        assert.equal(editorFor('s1').hidden, false);
        assert.equal(editBtnFor('s1').getAttribute('aria-expanded'), 'true');
    });

    test('opening the editor hides the read-only chips and seeds the widget from them', () => {
        render([scan('s1', ['desktop', 'checkout'])]);
        click(editBtnFor('s1'));

        assert.equal(regionFor('s1').querySelector('.scan-tags-display').hidden, true);
        assert.deepEqual(widgetChips('s1'), ['desktop', 'checkout']);
    });

    test('saving reports the unchanged list when nothing was edited', () => {
        render([scan('s1', ['desktop'])]);
        click(editBtnFor('s1'));
        click(editorFor('s1').querySelector('.scan-tags-edit__save'));

        assert.deepEqual(edits, [{scanId: 's1', tags: ['desktop']}]);
    });

    test('adding a tag and saving reports it alongside the existing ones', () => {
        render([scan('s1', ['desktop'])]);
        click(editBtnFor('s1'));

        const entry = editorFor('s1').querySelector('.tag-input__entry');
        typeInto(entry, 'checkout');
        pressKey(entry, 'Enter');
        click(editorFor('s1').querySelector('.scan-tags-edit__save'));

        assert.deepEqual(edits, [{scanId: 's1', tags: ['desktop', 'checkout']}]);
    });

    test('adding the first tag to an untagged scan', () => {
        render([scan('s1', null)]);
        click(editBtnFor('s1'));

        const entry = editorFor('s1').querySelector('.tag-input__entry');
        typeInto(entry, 'mobile');
        pressKey(entry, 'Enter');
        click(editorFor('s1').querySelector('.scan-tags-edit__save'));

        assert.deepEqual(edits, [{scanId: 's1', tags: ['mobile']}]);
    });

    test('removing every chip and saving reports an empty list', () => {
        render([scan('s1', ['desktop', 'checkout'])]);
        click(editBtnFor('s1'));

        // Each removal repaints the chip list, so the next button has to be
        // looked up again rather than held from a stale NodeList.
        let remove;
        while ((remove = editorFor('s1').querySelector('.scan-tag__remove'))) click(remove);
        click(editorFor('s1').querySelector('.scan-tags-edit__save'));

        assert.deepEqual(edits, [{scanId: 's1', tags: []}]);
    });

    test('cancelling discards the edit and restores the chips', () => {
        render([scan('s1', ['desktop'])]);
        click(editBtnFor('s1'));

        const entry = editorFor('s1').querySelector('.tag-input__entry');
        typeInto(entry, 'checkout');
        pressKey(entry, 'Enter');
        click(editorFor('s1').querySelector('.scan-tags-edit__cancel'));

        assert.deepEqual(edits, []);
        assert.equal(editorFor('s1').hidden, true);
        assert.equal(regionFor('s1').querySelector('.scan-tags-display').hidden, false);
        assert.deepEqual(chipsFor('s1'), ['desktop']);
    });

    test('Escape leaves the editor once the suggestion list is closed', () => {
        suggestionPool = ['mobile'];
        render([scan('s1', ['desktop'])]);
        click(editBtnFor('s1'));

        const entry = editorFor('s1').querySelector('.tag-input__entry');
        typeInto(entry, 'mob');
        assert.equal(editorFor('s1').querySelector('.tag-input__listbox').hidden, false);

        // First Escape is consumed by the open listbox.
        pressKey(entry, 'Escape');
        assert.equal(editorFor('s1').hidden, false);

        pressKey(entry, 'Escape');
        assert.equal(editorFor('s1').hidden, true);
        assert.deepEqual(edits, []);
    });

    test('pressing the edit button again closes the editor without saving', () => {
        render([scan('s1', ['desktop'])]);
        click(editBtnFor('s1'));

        const entry = editorFor('s1').querySelector('.tag-input__entry');
        typeInto(entry, 'checkout');
        pressKey(entry, 'Enter');
        click(editBtnFor('s1'));

        assert.deepEqual(edits, []);
        assert.equal(editorFor('s1').hidden, true);
    });

    test('suggestions exclude tags already on the edited scan', () => {
        suggestionPool = ['mobile', 'checkout'];
        render([scan('s1', ['checkout'])]);
        click(editBtnFor('s1'));

        const entry = editorFor('s1').querySelector('.tag-input__entry');
        typeInto(entry, '');

        const offered = Array.from(editorFor('s1').querySelectorAll('.tag-input__option')).map((o) => o.textContent);
        assert.deepEqual(offered, ['mobile']);
    });

    test('a tag removed mid-edit is offered back as a suggestion', () => {
        suggestionPool = ['desktop', 'checkout'];
        render([scan('s1', ['checkout'])]);
        click(editBtnFor('s1'));

        const entry = editorFor('s1').querySelector('.tag-input__entry');
        typeInto(entry, '');
        assert.deepEqual(
            Array.from(editorFor('s1').querySelectorAll('.tag-input__option')).map((o) => o.textContent),
            ['desktop'],
        );

        click(editorFor('s1').querySelector('.scan-tag__remove'));
        typeInto(entry, '');

        assert.deepEqual(
            Array.from(editorFor('s1').querySelectorAll('.tag-input__option')).map((o) => o.textContent),
            ['desktop', 'checkout'],
        );
    });

    test('each scan gets its own editor and reports its own id', () => {
        render([scan('s1', ['desktop']), scan('s2', ['mobile'])]);

        click(editBtnFor('s2'));
        click(editorFor('s2').querySelector('.scan-tags-edit__save'));

        assert.deepEqual(edits, [{scanId: 's2', tags: ['mobile']}]);
        assert.equal(editorFor('s1').hidden, true);
    });

    // The host repaints the chips after an edit without re-rendering the scan,
    // so the widget has to seed from the chips rather than the render-time clone.
    test('reopening after a repaint seeds the widget from the current chips', () => {
        render([scan('s1', ['desktop'])]);

        click(editBtnFor('s1'));
        const entry = editorFor('s1').querySelector('.tag-input__entry');
        typeInto(entry, 'checkout');
        pressKey(entry, 'Enter');
        click(editorFor('s1').querySelector('.scan-tags-edit__save'));

        regionFor('s1').querySelector('.scan-tags-display').innerHTML =
            '<span class="scan-tags"><span class="scan-tag">desktop</span><span class="scan-tag">checkout</span></span>';

        click(editBtnFor('s1'));
        assert.deepEqual(widgetChips('s1'), ['desktop', 'checkout']);

        click(editorFor('s1').querySelector('.scan-tags-edit__save'));
        assert.deepEqual(edits[1], {scanId: 's1', tags: ['desktop', 'checkout']});
    });

    test('a scan whose tags were all removed reopens with an empty widget', () => {
        render([scan('s1', ['desktop'])]);

        click(editBtnFor('s1'));
        click(editorFor('s1').querySelector('.scan-tag__remove'));
        click(editorFor('s1').querySelector('.scan-tags-edit__save'));

        regionFor('s1').querySelector('.scan-tags-display').innerHTML = '';

        click(editBtnFor('s1'));
        assert.deepEqual(widgetChips('s1'), []);
    });

    test('the edit button is disabled when the host provides no handler', () => {
        render([scan('s1', ['desktop'])], {onEditScanTags: null});

        const btn = editBtnFor('s1');
        assert.equal(btn.disabled, true);
        assert.equal(btn.getAttribute('aria-disabled'), 'true');

        click(btn);
        assert.equal(editorFor('s1').hidden, true);
    });
});

// The report's own output has to pass what the tool sells: glyphs are decorative
// with the word beside them, tables ship scoped headers, and every control names
// itself.
describe('scan renderer — accessibility invariants', () => {
    function fullScan(id) {
        return {
            id,
            label: 'Home',
            scanTags: ['desktop'],
            url: 'https://example.test/',
            wcagLevel: 'AA',
            canonical: {
                page: {url: 'https://example.test/'},
                findings: [{
                    id: 'image-alt', ruleId: 'image-alt', outcome: 'fail', severity: 'critical',
                    title: 'Images must have alternative text',
                    provenance: {engine: {name: 'Engine B'}},
                    wcag: {sc: ['1.1.1']},
                    occurrences: [{target: ['img.hero'], html: '<img class="hero">', outcome: 'fail'}]
                }],
                diagnostics: {durationMs: 10, estimatedNodes: 100}
            },
            summary: {failCount: 1, passesCount: 0, reviewCount: 0}
        };
    }

    test('result glyphs are decorative and always paired with their word', () => {
        render([fullScan('s1')]);

        const glyphs = [...resultsEl.querySelectorAll('.result-glyph')];
        assert.ok(glyphs.length, 'expected result glyph tiles');

        for (const g of glyphs) {
            assert.equal(g.getAttribute('aria-hidden'), 'true',
                `glyph "${g.textContent}" is announced instead of decorative`);
            const spoken = (g.parentElement.textContent || '').replace(g.textContent, '').trim();
            assert.ok(spoken.length > 0,
                `glyph "${g.textContent}" carries the meaning alone, with no word beside it`);
        }
    });

    test('the results table ships a name and scoped column headers', () => {
        render([fullScan('s1')]);

        const table = resultsEl.querySelector('table');
        assert.ok(table, 'expected the issues table');
        assert.ok((table.getAttribute('aria-label') || '').trim().length > 0, 'the table must name itself');

        const ths = [...table.querySelectorAll('th')];
        assert.deepEqual(
            ths.map((th) => th.textContent),
            ['Status', 'Severity', 'Description', 'Occurrences', 'Criteria']
        );
        for (const th of ths) {
            assert.equal(th.getAttribute('scope'), 'col', `<th>${th.textContent}</th> has no column scope`);
        }
        // A width for each column, the same in every table, so they line up.
        assert.deepEqual([...table.querySelectorAll('col')].map((c) => c.style.width), ['11%', '11%', '42%', '17%', '19%']);
    });

    test('an Engine column only for a report more than one engine ran', () => {
        const other = fullScan('s2');
        other.canonical = {...other.canonical, engines: [{id: 'other', name: 'Other engine'}]};
        const renderer = makeRenderer();
        renderer.setReportEngines([fullScan('s1'), other]);
        renderer.renderAllScans([fullScan('s1')]);

        const table = resultsEl.querySelector('table');
        assert.deepEqual([...table.querySelectorAll('th')].map((th) => th.textContent),
            ['Status', 'Severity', 'Description', 'Occurrences', 'Engine', 'Criteria']);
        assert.equal(table.querySelector('td.engine-name').textContent, 'Engine B');
        const widths = [...table.querySelectorAll('col')].map((c) => parseFloat(c.style.width));
        assert.equal(widths.reduce((a, b) => a + b, 0), 100);
    });

    test('every scan control names itself beyond its glyph', () => {
        render([fullScan('s1'), fullScan('s2')]);

        const controls = [...resultsEl.querySelectorAll('.scan-header-controls button')];
        assert.ok(controls.length >= 4);

        for (const btn of controls) {
            const name = (btn.getAttribute('aria-label') || btn.textContent || '').trim();
            assert.ok(name.length > 2, `a control is named only "${name}"`);
        }
    });

    test('the move controls do not rely on their arrow glyph alone', () => {
        render([fullScan('s1'), fullScan('s2')]);

        for (const cls of ['.scan-move-up', '.scan-move-down']) {
            const btn = resultsEl.querySelector(cls);
            assert.ok(btn, `expected ${cls}`);
            assert.match(btn.getAttribute('aria-label') || '', /move scan (up|down)/i);
        }
    });

    test('the tag editor control reports its expanded state', () => {
        render([fullScan('s1')]);

        const btn = editBtnFor('s1');
        assert.equal(btn.getAttribute('aria-expanded'), 'false');
        click(btn);
        assert.equal(btn.getAttribute('aria-expanded'), 'true');
        click(btn);
        assert.equal(btn.getAttribute('aria-expanded'), 'false');
    });
});

// Reordering re-sequences the existing cards instead of re-rendering them, so a
// move button has to stay wired while it is disabled: a scan sitting at an end
// gets re-enabled in place the moment something moves past it.
describe('scan move controls', () => {
    const upFor = (id) => resultsEl.querySelector(`[data-scan-action="move-up"][data-scan-id="${id}"]`);
    const downFor = (id) => resultsEl.querySelector(`[data-scan-action="move-down"][data-scan-id="${id}"]`);

    // The app loads scan-sort.js as a plain script; the renderer only stamps the
    // sort attributes when it is present.
    before(() => {
        globalThis.A11Y_SCAN_SORT = {
            scanSortValues: () => ({failures: 0, occurrences: 0}),
            scanSortAttrs: () => ''
        };
    });

    function renderThree(overrides = {}) {
        render(
            [scan('s1', null), scan('s2', null), scan('s3', null)],
            {onMoveScan: () => {}, ...overrides}
        );
    }

    test('the ends start disabled', () => {
        renderThree();
        assert.equal(upFor('s1').disabled, true, 'the first scan cannot move up');
        assert.equal(downFor('s3').disabled, true, 'the last scan cannot move down');
        assert.equal(upFor('s2').disabled, false);
    });

    test('a disabled end button is still wired, so re-enabling it in place works', () => {
        const moves = [];
        renderThree({onMoveScan: (id, dir) => moves.push({id, dir})});

        const btn = upFor('s1');
        assert.equal(btn.disabled, true);

        // What a reorder does: flip the state without rebuilding the card.
        btn.disabled = false;
        btn.removeAttribute('aria-disabled');
        click(btn);

        assert.deepEqual(moves, [{id: 's1', dir: -1}],
            'the button lost its handler, so moving past an end would go dead');
    });

    test('the same holds for the last scan moving down', () => {
        const moves = [];
        renderThree({onMoveScan: (id, dir) => moves.push({id, dir})});

        const btn = downFor('s3');
        btn.disabled = false;
        click(btn);

        assert.deepEqual(moves, [{id: 's3', dir: 1}]);
    });

    test('an enabled button reports its direction', () => {
        const moves = [];
        renderThree({onMoveScan: (id, dir) => moves.push({id, dir})});

        click(upFor('s2'));
        click(downFor('s2'));

        assert.deepEqual(moves, [{id: 's2', dir: -1}, {id: 's2', dir: 1}]);
    });

    test('an end button is truly disabled, not merely marked aria-disabled', () => {
        const moves = [];
        renderThree({onMoveScan: (id, dir) => moves.push({id, dir})});

        // Native activation honours the disabled property; dispatching a click
        // event would bypass it and prove nothing.
        upFor('s1').click();

        assert.deepEqual(moves, [], 'a disabled control must not act');
        assert.equal(upFor('s1').getAttribute('aria-disabled'), 'true');
    });

    test('cards carry the sort order the reorder restamps', () => {
        renderThree();
        const cards = [...resultsEl.querySelectorAll('[data-scan-id][data-sort-order]')];
        assert.deepEqual(cards.map((c) => c.getAttribute('data-sort-order')), ['0', '1', '2']);
    });

    test('every move control is addressable by scan id', () => {
        renderThree();
        for (const id of ['s1', 's2', 's3']) {
            assert.ok(upFor(id), `${id} has no addressable move-up`);
            assert.ok(downFor(id), `${id} has no addressable move-down`);
        }
    });
});
