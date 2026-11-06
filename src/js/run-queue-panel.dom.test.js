'use strict';

// DOM tests for the queue tab (createRunQueuePanel), under jsdom: how sessions
// and runs render, which actions each run offers, what is announced, and that
// focus survives the re-render every poll does.

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let mod;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Node = win.Node;
    globalThis.HTMLElement = win.HTMLElement;
    globalThis.CSS = win.CSS && win.CSS.escape ? win.CSS : {escape: (s) => String(s).replace(/["\\]/g, '\\$&')};
    mod = await import('./run-queue-panel.js');
});

beforeEach(() => {
    document.body.innerHTML = `
        <select id="c"></select>
        <button id="all" aria-disabled="true">Cancel all</button>
        <div id="status" class="status" role="status"></div>
        <div id="list"></div>`;
});

/** A cell's text as assistive technology gets it: decorative (aria-hidden) and hidden parts left out. */
function accessibleText(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1 || node.getAttribute('aria-hidden') === 'true' || node.hidden) return '';
    return [...node.childNodes].map(accessibleText).join('');
}

function baseItem(over = {}) {
    return {
        id: 'i1', name: 'Product v2.3', url: 'https://example.com/v2.3', status: 'done',
        scans: 4, findings: {fail: 6, cantTell: 72, pass: 138},
        durationMs: 65000, file: 'Product-v2.3.json', fileUrl: '/reports/batches/S/Product-v2.3.json',
        error: null, needsValues: false, hasConfig: true, ...over,
    };
}

function session(over = {}, items = [baseItem()]) {
    const counts = {total: items.length};
    for (const i of items) counts[i.status] = (counts[i.status] || 0) + 1;
    return {
        id: '2026-10-12T14-03-27', startedAt: '2026-10-12T14:03:27.000Z', finishedAt: null,
        state: 'finished', resumable: false, counts, items,
        manifestUrl: '/reports/batches/2026-10-12T14-03-27/batch.json',
        zipUrl: '/queue/sessions/2026-10-12T14-03-27/download.zip',
        ...over,
    };
}

/** A fetch that serves queued GET /queue states and records POSTs. */
function fakeServer(states, {maskedFields = []} = {}) {
    const posts = [];
    let current = null;
    const fetchImpl = async (url, opts = {}) => {
        if (url.includes('/masked-fields')) {
            return {ok: true, status: 200, json: async () => ({fields: maskedFields})};
        }
        if ((opts.method || 'GET') === 'POST') {
            posts.push({url, body: JSON.parse(opts.body || '{}')});
            return {ok: true, status: 200, json: async () => ({resumed: 2, cancelled: 1, concurrency: 2})};
        }
        // Each GET serves the next state; the last one repeats.
        if (states.length) current = states.shift();
        return {ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(current))};
    };
    return {fetchImpl, posts};
}

/** Waits until `check` holds, so a busy machine is not mistaken for a failure. */
async function until(check, what, ms = 2000) {
    const end = Date.now() + ms;
    while (!check()) {
        if (Date.now() > end) assert.fail(`Timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 5));
    }
}

function panel(states, {maskedFields, ...opts} = {}) {
    const server = fakeServer(states, {maskedFields});
    const p = mod.createRunQueuePanel({
        listEl: document.getElementById('list'),
        concurrencySelect: document.getElementById('c'),
        cancelAllButton: document.getElementById('all'),
        statusEl: document.getElementById('status'),
        fetchImpl: server.fetchImpl,
        pollMs: 60000,
        ...opts,
    });
    return {p, server};
}

describe('run queue panel', () => {
    test('says nothing is queued when there are no sessions', async () => {
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: []}]);
        await p.refresh();
        assert.match(document.getElementById('list').textContent, /Nothing queued yet/);
    });

    test('renders a session as a headed section with its links and a table of runs', async () => {
        const {p} = panel([{concurrency: 2, maxConcurrency: 4, sessions: [session()]}]);
        await p.refresh();

        const section = document.querySelector('section.queue-session');
        const heading = section.querySelector('h3');
        assert.equal(section.getAttribute('aria-labelledby'), heading.id);
        assert.match(heading.textContent, /^Queue started /);

        const zip = section.querySelector('a[href$="download.zip"]');
        assert.equal(zip.textContent, 'Download all (zip)');
        assert.ok(zip.hasAttribute('download'));
        assert.equal(section.querySelector('a[href$="batch.json"]'), null, 'batch.json comes in the zip, not on its own');

        const headers = [...section.querySelectorAll('thead th')].map((th) => th.textContent);
        assert.deepEqual(headers, ['Name', 'Status', 'Scans', 'Failing', 'Can’t tell', 'Passing', 'Duration', 'Actions']);

        const row = section.querySelector('tbody tr');
        const cells = [...row.children].map(accessibleText);
        assert.equal(row.querySelector('th').getAttribute('scope'), 'row');
        assert.match(cells[0], /Product v2\.3/);
        assert.equal(cells[1], 'Done');
        assert.equal(row.children[2].firstChild.textContent, '4');
        assert.equal(cells[2], '41 every 16s', 'its count, then its pace as a note: 65 s over 4 scans');
        assert.equal(cells[3], '6');
        assert.equal(cells[4], '72');
        assert.equal(cells[5], '138');
        assert.equal(cells[6], '1m 05s');

        // Automatic first, then 1 to the maximum.
        assert.equal(document.getElementById('c').options.length, 5);
        assert.equal(document.getElementById('c').value, '2');
    });

    test('the default is Automatic, saying how many it runs while a batch runs', async () => {
        const {p} = panel([{concurrency: 3, concurrencyChosen: false, maxConcurrency: 8, sessions: [session({state: 'running'})]}]);
        await p.refresh();
        const select = document.getElementById('c');
        assert.equal(select.value, 'auto');
        assert.equal(select.options[0].textContent, 'Automatic (3)');
        assert.equal(select.options.length, 9);
    });

    test('a finished run\'s figures carry their outcome\'s tile after them, hidden from assistive technology; none on 0 or while running', async () => {
        const {p} = panel([{concurrency: 2, maxConcurrency: 4, sessions: [session({state: 'running'}, [
            baseItem({id: 'a', findings: {fail: 6, cantTell: 0, pass: 138}}),
            baseItem({id: 'b', status: 'running', durationMs: null, elapsedMs: 3000, file: null, findings: {fail: 2, cantTell: 18, pass: 44, soFar: true}}),
        ])]}]);
        await p.refresh();
        const [done, running] = [...document.querySelectorAll('tbody tr')];
        const cells = (row) => [3, 4, 5].map((i) => row.children[i]);

        const [fail, cantTell, pass] = cells(done);
        assert.equal(fail.textContent, '6✕', 'the number, then its tile');
        assert.equal(fail.lastElementChild.className, 'result-glyph result-glyph--fail result-glyph--sm');
        assert.equal(pass.lastElementChild.className, 'result-glyph result-glyph--pass result-glyph--sm');
        assert.equal(cantTell.textContent, '0', 'no tile on 0');
        assert.ok(cantTell.querySelector('.queue-glyph-slot'), 'but its width, so the numbers stay in line');

        for (const row of [done, running]) {
            for (const decor of row.querySelectorAll('.result-glyph, .queue-glyph-slot, .queue-spinner')) {
                assert.equal(decor.getAttribute('aria-hidden'), 'true', 'decorative: the header and the number say it');
            }
        }
        assert.equal(running.querySelectorAll('.result-glyph').length, 0, 'figures so far carry no tile');
    });

    test('the spinner comes after the status word, so every word starts at the same edge', async () => {
        const {p} = panel([{concurrency: 2, maxConcurrency: 4, sessions: [session({state: 'running'}, [
            baseItem({id: 'a', status: 'running', durationMs: null, elapsedMs: 3000, file: null, findings: null}),
        ])]}]);
        await p.refresh();
        const status = document.querySelector('tbody tr').children[1];
        assert.equal(status.firstChild.nodeType, 3, 'the word first');
        assert.equal(status.firstChild.textContent, 'Running');
        assert.ok(status.querySelector('.queue-spinner').previousSibling === status.firstChild);
    });

    test('a running row\'s spinner keeps its angle when the table is built again', async () => {
        // Rebuilt on every poll, a new spinner would start its turn over: it
        // starts as far into its turn as the page clock says instead.
        const {p} = panel([{concurrency: 2, maxConcurrency: 4, sessions: [session({state: 'running'}, [
            baseItem({id: 'a', status: 'running', durationMs: null, elapsedMs: 3000, file: null, findings: null}),
        ])]}]);
        await p.refresh();
        const spinner = document.querySelector('.queue-spinner');
        const delay = /animation-delay: -(\d+)ms/.exec(spinner.getAttribute('style') || '');
        assert.ok(delay, 'a negative animation delay');
        assert.ok(Number(delay[1]) < 900, 'within one turn');
    });

    test('a running row\'s duration counts on each second between polls; a finished one stays put', async () => {
        // The server can be too busy to answer a poll for a while (building a
        // long run's result): the clock must not wait for it.
        const {p} = panel([{concurrency: 2, maxConcurrency: 4, sessions: [session({state: 'running'}, [
            baseItem({id: 'a'}),
            baseItem({id: 'b', status: 'running', durationMs: null, elapsedMs: 3000, file: null, findings: null}),
        ])]}]);
        p.setVisible(true);
        const duration = (id) => document.querySelector(`tr[data-item-id="${id}"]`)?.children[6].textContent;
        await until(() => duration('b') === '3s', 'the first poll');
        await until(() => duration('b') === '4s', 'the clock to tick', 2500);
        assert.equal(duration('a'), '1m 05s');
        p.setVisible(false);
    });

    test('a running row\'s clock stops when the server cannot be reached, and starts again from the server\'s figure', async () => {
        const running = {concurrency: 1, maxConcurrency: 4, sessions: [session({state: 'running'}, [
            baseItem({id: 'b', status: 'running', durationMs: null, elapsedMs: 3000, file: null, findings: null}),
        ])]};
        let down = false;
        let elapsedMs = 3000;
        const p = mod.createRunQueuePanel({
            listEl: document.getElementById('list'),
            statusEl: document.getElementById('status'),
            fetchImpl: async () => {
                if (down) throw new Error('Failed to fetch');
                const next = JSON.parse(JSON.stringify(running));
                next.sessions[0].items[0].elapsedMs = elapsedMs;
                return {ok: true, status: 200, json: async () => next};
            },
            pollMs: 60000,
        });
        const duration = () => document.querySelector('tr[data-item-id="b"]')?.children[6].textContent;
        p.setVisible(true);
        await until(() => duration() === '3s', 'the first poll');

        down = true;
        await p.refresh();
        const frozen = duration();
        await new Promise((r) => setTimeout(r, 1300));
        assert.equal(duration(), frozen, 'no counting while the server is gone');

        down = false;
        elapsedMs = 20000;
        await p.refresh();
        assert.equal(duration(), '20s', 'the server\'s figure, not the one the panel had');
        await until(() => duration() === '21s', 'the clock to tick again', 2500);
        p.setVisible(false);
    });

    test('a run whose Merged scans folded scans together says how many ran, as text under the count', async () => {
        const {p} = panel([{concurrency: 2, maxConcurrency: 4, sessions: [session({}, [
            baseItem({id: 'a', scans: 12, scansRun: 20}),
            baseItem({id: 'b', scans: 4, scansRun: 4}),
        ])]}]);
        await p.refresh();
        const [merged, plain] = [...document.querySelectorAll('tbody tr')].map((r) => r.children[2]);
        const notes = (cell) => [...cell.querySelectorAll('.queue-note')].map((n) => n.textContent);
        assert.equal(merged.firstChild.textContent, '12');
        assert.deepEqual(notes(merged), ['20 before merging', '1 every 3.3s'], 'pace over every scan that ran');
        assert.equal(plain.firstChild.textContent, '4');
        assert.deepEqual(notes(plain), ['1 every 16s']);
    });

    test('names the run in every action for screen readers, and links the download to its file', async () => {
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [session()]}]);
        await p.refresh();
        const open = document.querySelector('[data-queue-action="open"]');
        assert.equal(open.textContent, 'Open Product v2.3');
        // Icon only on screen: the whole name is hidden text, the verb a tooltip.
        assert.equal(open.querySelector('.visually-hidden').textContent, 'Open Product v2.3');
        assert.equal(open.getAttribute('title'), 'Open');
        assert.equal(open.querySelector('svg').getAttribute('aria-hidden'), 'true');
        const download = document.querySelector('tbody a.secondary-button');
        assert.equal(download.getAttribute('href'), '/reports/batches/S/Product-v2.3.json');
        assert.equal(download.getAttribute('download'), 'Product-v2.3.json');
    });

    test('offers cancel only on unfinished runs of the running session, and enables cancel all', async () => {
        const items = [
            baseItem({id: 'a', status: 'running', scans: 1, durationMs: null, elapsedMs: 3000, file: null, fileUrl: null, findings: null}),
            baseItem({id: 'b', status: 'waiting', scans: null, durationMs: null, file: null, fileUrl: null, findings: null}),
            baseItem({id: 'c'}),
        ];
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [session({state: 'running'}, items)]}]);
        await p.refresh();
        const cancels = [...document.querySelectorAll('[data-queue-action="cancel"]')].map((b) => b.dataset.itemId);
        assert.deepEqual(cancels, ['a', 'b']);
        assert.equal(document.getElementById('all').getAttribute('aria-disabled'), 'false');
        assert.match(document.querySelector('.queue-session-meta').textContent, /Running · 1 of 3 finished · 1 waiting/);
        assert.equal(document.querySelector('tr[data-item-id="a"]').children[6].textContent, '3s');
    });

    test('an interrupted session offers resume; a run that lost its masked values offers load workflow', async () => {
        const items = [
            baseItem({id: 'a', status: 'interrupted', file: null, fileUrl: null, findings: null, scans: null}),
            baseItem({id: 'b', status: 'interrupted', needsValues: true, file: null, fileUrl: null, findings: null, scans: null}),
        ];
        const loaded = [];
        const {p, server} = panel([
            {concurrency: 1, maxConcurrency: 4, sessions: [session({state: 'interrupted', resumable: true}, items)]},
        ], {onLoadWorkflow: (item, s) => loaded.push([item.id, s.id])});
        await p.refresh();

        assert.match(document.querySelector('.queue-session-meta').textContent, /Interrupted by a server restart/);
        assert.match(document.querySelector('tr[data-item-id="b"]').textContent, /passwords were not saved/);
        const load = document.querySelector('[data-queue-action="load"]');
        assert.equal(load.getAttribute('title'), 'Load workflow');
        assert.equal(accessibleText(load), 'Load workflow Product v2.3', 'named for its run, as the other row actions');
        assert.ok(load.classList.contains('queue-icon-button'));
        load.click();
        assert.deepEqual(loaded, [['b', '2026-10-12T14-03-27']]);

        document.querySelector('[data-queue-action="resume"]').click();
        await until(() => server.posts.length, 'the resume POST');
        await p.refresh();
        assert.equal(server.posts[0].url, '/queue/sessions/2026-10-12T14-03-27/resume');
        assert.match(document.getElementById('status').textContent, /Resumed 2 runs/);
    });

    test('resume asks for the hidden values runs need, and sends them with the resume', async () => {
        const fields = [{key: 'k1', action: 'Set field value', field: 'Value', target: '#pass', where: 'Step 2', rows: 3}];
        const asked = [];
        const items = [baseItem({id: 'b', status: 'interrupted', file: null, fileUrl: null, needsValues: true})];
        const {p, server} = panel([
            {concurrency: 1, maxConcurrency: 4, sessions: [session({state: 'interrupted', resumable: true, needsValues: true}, items)]},
        ], {maskedFields: fields, askMaskedValues: async (f) => { asked.push(f); return {k1: 'hunter2'}; }});
        await p.refresh();
        document.querySelector('[data-queue-action="resume"]').click();
        await until(() => server.posts.length, 'the resume POST');
        await p.refresh();
        assert.deepEqual(asked, [fields]);
        assert.deepEqual(server.posts, [{url: '/queue/sessions/2026-10-12T14-03-27/resume', body: {values: {k1: 'hunter2'}}}]);
    });

    test('resume always asks, with the passwords still typed in the editor filled in', async () => {
        const fields = [{key: 'k1', action: 'Set password value', field: 'Password', target: '#pass', where: 'Step 2', rows: 3,
            match: {path: ['actions', 1], field: 'value', step: {type: 'setPassword', selector: '#pass', valueMasked: true}}}];
        const asked = [];
        const items = [baseItem({id: 'b', status: 'interrupted', file: null, fileUrl: null, needsValues: true})];
        const {p, server} = panel([
            {concurrency: 1, maxConcurrency: 4, sessions: [session({state: 'interrupted', resumable: true, needsValues: true}, items)]},
        ], {
            maskedFields: fields,
            askMaskedValues: async (f) => { asked.push(f); return {k1: f[0].value}; },
            getFormWorkflow: () => ({actions: [{type: 'goto'}, {type: 'setPassword', selector: '#pass', value: 'hunter2', valueMasked: true}]}),
        });
        await p.refresh();
        document.querySelector('[data-queue-action="resume"]').click();
        await until(() => server.posts.length, 'the resume POST');
        await p.refresh();
        assert.equal(asked.length, 1, 'asked, though the editor had them all');
        assert.equal(asked[0][0].value, 'hunter2', 'filled in from the editor');
        assert.deepEqual(server.posts, [{url: '/queue/sessions/2026-10-12T14-03-27/resume', body: {values: {k1: 'hunter2'}}}]);
        assert.doesNotMatch(document.getElementById('status').textContent, /from the open workflow/);
    });

    test('resume fills in the passwords the editor has, and leaves the others to type', async () => {
        const fields = [
            {key: 'k1', action: 'a', field: 'f', rows: 1,
                match: {path: ['actions', 0], field: 'value', step: {type: 'setPassword', selector: '#pass', valueMasked: true}}},
            {key: 'k2', action: 'a', field: 'f', rows: 1,
                match: {path: ['actions', 1], field: 'value', step: {type: 'setPassword', labelText: 'PIN', valueMasked: true}}},
        ];
        const asked = [];
        const items = [baseItem({id: 'b', status: 'interrupted', file: null, fileUrl: null, needsValues: true})];
        const {p, server} = panel([
            {concurrency: 1, maxConcurrency: 4, sessions: [session({state: 'interrupted', resumable: true, needsValues: true}, items)]},
        ], {
            maskedFields: fields,
            askMaskedValues: async (f) => { asked.push(f); return {k1: 'hunter2', k2: '4321'}; },
            getFormWorkflow: () => ({actions: [{type: 'setPassword', selector: '#pass', value: 'hunter2', valueMasked: true}]}),
        });
        await p.refresh();
        document.querySelector('[data-queue-action="resume"]').click();
        await until(() => server.posts.length, 'the resume POST');
        await p.refresh();
        assert.deepEqual(asked[0].map((f) => f.value), ['hunter2', undefined]);
        assert.deepEqual(server.posts[0].body, {values: {k1: 'hunter2', k2: '4321'}});
    });

    test('dismissing the values prompt resumes nothing', async () => {
        const items = [baseItem({id: 'b', status: 'interrupted', file: null, fileUrl: null, needsValues: true})];
        const {p, server} = panel([
            {concurrency: 1, maxConcurrency: 4, sessions: [session({state: 'interrupted', resumable: true, needsValues: true}, items)]},
        ], {maskedFields: [{key: 'k1', action: 'a', field: 'f', rows: 1}], askMaskedValues: async () => null});
        await p.refresh();
        document.querySelector('[data-queue-action="resume"]').click();
        await until(() => document.getElementById('status').textContent === 'Not resumed.', 'the prompt to be dismissed');
        await p.refresh();
        assert.deepEqual(server.posts, []);
        assert.equal(document.getElementById('status').textContent, 'Not resumed.');
    });

    test('the values dialog labels each field, returns what was typed, and leaves nothing behind', async () => {
        // jsdom has no modal dialogs: enough of one for the prompt.
        const proto = window.HTMLDialogElement?.prototype || window.HTMLElement.prototype;
        proto.showModal = function () { this.setAttribute('open', ''); };
        proto.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
        const fields = [
            {key: 'k1', action: 'Set field value', field: 'Value', target: '#pass', where: 'Step 2 › 1', rows: 2},
            {key: 'k2', action: 'Set field value', field: 'Value', target: null, where: 'Custom step “Login” · Step 1', rows: 2},
        ];
        const pending = mod.askMaskedValuesInDialog(document, fields);
        const dialog = document.querySelector('dialog.queue-values-dialog');
        assert.ok(dialog.hasAttribute('open'));
        assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent, 'Type the passwords again');
        const inputs = [...dialog.querySelectorAll('input')];
        assert.equal(document.activeElement, inputs[0]);
        assert.deepEqual(inputs.map((i) => i.type), ['password', 'password']);
        assert.equal(dialog.querySelector(`label[for="${inputs[0].id}"]`).textContent, 'Set field value · Value (#pass)');
        assert.deepEqual([...document.getElementById(inputs[1].getAttribute('aria-describedby')).children].map((li) => li.textContent),
            ['In: Custom step “Login” · Step 1', 'Used by 2 runs']);

        inputs[0].value = 'hunter2';
        inputs[1].value = '4321';
        dialog.querySelector('form').dispatchEvent(new window.Event('submit'));
        dialog.close();
        assert.deepEqual(await pending, {k1: 'hunter2', k2: '4321'});
        assert.equal(document.querySelector('dialog.queue-values-dialog'), null);

        const dismissed = mod.askMaskedValuesInDialog(document, fields, {action: 'Run again'});
        assert.equal(document.querySelector('dialog.queue-values-dialog button[type="submit"]').textContent, 'Run again');
        document.querySelector('dialog.queue-values-dialog [data-dismiss]').click();
        assert.equal(await dismissed, null);
    });

    test('the values dialog comes with the passwords found in the editor filled in, and focuses the first empty one', async () => {
        const proto = window.HTMLDialogElement?.prototype || window.HTMLElement.prototype;
        proto.showModal = function () { this.setAttribute('open', ''); };
        proto.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
        const pending = mod.askMaskedValuesInDialog(document, [
            {key: 'k1', action: 'a', field: 'f', where: 'Step 1', rows: 1, value: 'hunter2'},
            {key: 'k2', action: 'a', field: 'f', where: 'Step 2', rows: 1},
        ]);
        const dialog = document.querySelector('dialog.queue-values-dialog');
        const inputs = [...dialog.querySelectorAll('input')];
        assert.deepEqual(inputs.map((i) => i.value), ['hunter2', '']);
        assert.equal(document.activeElement, inputs[1]);
        assert.match(document.getElementById(inputs[0].getAttribute('aria-describedby')).textContent, /Filled in from the open workflow/);
        dialog.querySelector('[data-dismiss]').click();
        assert.equal(await pending, null);
    });

    test('each password says where it is asked, what comes just before it and which runs it is for', async () => {
        const proto = window.HTMLDialogElement?.prototype || window.HTMLElement.prototype;
        proto.showModal = function () { this.setAttribute('open', ''); };
        proto.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
        const pending = mod.askMaskedValuesInDialog(document, [{
            key: 'k1', action: 'Set password value', field: 'Password', target: '#pin', where: 'Step 5 › 2', rows: 5,
            trail: ['Step 5: Group · “Second factor”'], position: 'Step 2',
            before: ['Set field value · Email = “jorge@shop.com”', 'Click · Use a PIN'],
            runs: [{name: 'Checkout', url: 'https://shop.test/'}, {name: 'Cart', url: 'https://shop.test/cart'}, {name: 'Home'}],
        }]);
        const input = document.querySelector('dialog.queue-values-dialog input');
        const lines = [...document.getElementById(input.getAttribute('aria-describedby')).children].map((li) => li.textContent);
        assert.deepEqual(lines, [
            'In: Step 5: Group · “Second factor” › Step 2',
            'After: Set field value · Email = “jorge@shop.com” › Click · Use a PIN',
            'For: Checkout (https://shop.test/), Cart (https://shop.test/cart), Home and 2 more runs',
        ]);
        document.querySelector('dialog.queue-values-dialog [data-dismiss]').click();
        assert.equal(await pending, null);
    });

    test('open hands the run and its session to the app', async () => {
        const opened = [];
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [session()]}], {
            onOpen: (item, s) => opened.push([item.file, s.id]),
        });
        await p.refresh();
        document.querySelector('[data-queue-action="open"]').click();
        assert.deepEqual(opened, [['Product-v2.3.json', '2026-10-12T14-03-27']]);
    });

    test('open shows the button busy until the result is open, and ignores a second press', async () => {
        let finish;
        const opened = [];
        const later = session({}, [baseItem({durationMs: 66000})]);
        const {p} = panel([
            {concurrency: 1, maxConcurrency: 4, sessions: [session()]},
            {concurrency: 1, maxConcurrency: 4, sessions: [later]},
        ], {
            onOpen: (item) => { opened.push(item.id); return new Promise((r) => { finish = r; }); },
        });
        await p.refresh();
        const openButton = () => document.querySelector('[data-queue-action="open"]');
        openButton().click();
        assert.equal(openButton().dataset.busy, 'true');
        assert.equal(openButton().getAttribute('aria-disabled'), 'true');
        assert.equal(document.getElementById('status').textContent, 'Opening “Product v2.3”…');
        assert.match(document.getElementById('status').className, /\bbusy\b/);

        openButton().click();
        assert.deepEqual(opened, ['i1'], 'not opened twice');

        // A poll re-renders the table: the new button is still busy.
        const before = openButton();
        await p.refresh();
        assert.notEqual(openButton(), before, 'the table was rebuilt');
        assert.equal(openButton().dataset.busy, 'true');

        finish();
        await until(() => openButton().dataset.busy !== 'true', 'the button to be released');
        assert.equal(openButton().hasAttribute('aria-disabled'), false);
        assert.equal(document.getElementById('status').textContent, '');
    });

    test('a slow action that reports a failure keeps its message', async () => {
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [session()]}], {
            onOpen: async () => { p.setStatus('Could not open “Product v2.3”: the server answered 500', 'error'); },
        });
        await p.refresh();
        document.querySelector('[data-queue-action="open"]').click();
        await until(() => document.querySelector('[data-queue-action="open"]').dataset.busy !== 'true', 'the button to be released');
        assert.equal(document.getElementById('status').textContent, 'Could not open “Product v2.3”: the server answered 500');
    });

    test('send to compare shows the batch busy while its results are read', async () => {
        let finish;
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [session()]}], {
            onSendToCompare: () => new Promise((r) => { finish = r; }),
        });
        await p.refresh();
        const button = () => document.querySelector('[data-queue-action="compare"]');
        button().click();
        assert.equal(button().dataset.busy, 'true');
        assert.equal(document.getElementById('status').textContent, 'Reading the batch’s results for Compare…');
        finish();
        await until(() => button().dataset.busy !== 'true', 'the button to be released');
    });

    test('while Compare loads, every batch holds Send to Compare, saying why, and lets it go after', async () => {
        const sent = [];
        const other = session({id: '2026-10-11T08-00-00', startedAt: '2026-10-11T08:00:00.000Z'});
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [session(), other]}], {
            onSendToCompare: (s) => sent.push(s.id),
        });
        await p.refresh();
        p.setCompareBlocked('Reports are still loading into Compare. Try again once they have.');
        const held = [...document.querySelectorAll('[data-focus-key^="compare:"]')];
        assert.equal(held.length, 2);
        for (const button of held) {
            assert.equal(button.getAttribute('aria-disabled'), 'true');
            button.click();
        }
        assert.deepEqual(sent, []);
        assert.equal(document.getElementById('status').textContent, 'Reports are still loading into Compare. Try again once they have.');

        p.setCompareBlocked(null);
        document.querySelector('[data-queue-action="compare"]').click();
        assert.equal(sent.length, 1);
    });

    test('a batch being sent to Compare cannot be deleted until it is done', async () => {
        let finish;
        const {p, server} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [session()]}], {
            onSendToCompare: () => new Promise((r) => { finish = r; }),
            confirmDelete: () => true,
        });
        await p.refresh();
        document.querySelector('[data-queue-action="compare"]').click();
        const del = () => document.querySelector('[data-focus-key^="delete:"]');
        assert.equal(del().getAttribute('aria-disabled'), 'true');
        del().click();
        assert.equal(server.posts.length, 0);
        assert.match(document.getElementById('status').textContent, /being sent to Compare/);

        finish();
        await until(() => del().getAttribute('data-queue-action') === 'delete', 'Delete to be offered again');
        assert.equal(del().hasAttribute('aria-disabled'), false);
    });

    test('changing runs at the same time posts the setting', async () => {
        const {p, server} = panel([{concurrency: 1, maxConcurrency: 4, sessions: []}]);
        await p.refresh();
        const select = document.getElementById('c');
        select.value = '2';
        select.dispatchEvent(new window.Event('change'));
        await new Promise((r) => setTimeout(r, 0));
        assert.deepEqual(server.posts[0], {url: '/queue/settings', body: {concurrency: 2}});
    });

    test('announces runs that finished since the last refresh, and nothing on the first', async () => {
        const running = session({state: 'running'}, [baseItem({status: 'running', file: null, fileUrl: null})]);
        const done = session({state: 'finished'}, [baseItem()]);
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [running]}, {concurrency: 1, maxConcurrency: 4, sessions: [done]}]);
        await p.refresh();
        assert.equal(document.getElementById('status').textContent, '');
        await p.refresh();
        assert.equal(document.getElementById('status').textContent, 'Product v2.3: done.');
    });

    test('keeps focus on the same control across a re-render, or on its row once the control is gone', async () => {
        const running = (status) => ({
            concurrency: 1, maxConcurrency: 4,
            sessions: [session({state: 'running'}, [baseItem({status, file: null, fileUrl: null, elapsedMs: 1000 * Math.random()})])],
        });
        const {p} = panel([running('running'), running('running'), {concurrency: 1, maxConcurrency: 4, sessions: [session()]}]);
        await p.refresh();
        document.querySelector('[data-queue-action="cancel"]').focus();

        await p.refresh();
        assert.equal(document.activeElement.dataset.queueAction, 'cancel', 'same control after a re-render');

        await p.refresh();
        assert.equal(document.activeElement.dataset.focusKey, 'row:i1', 'its row once the control is gone');
    });

    test('putting focus back after a poll does not scroll the page to it', async () => {
        const running = () => ({
            concurrency: 1, maxConcurrency: 4,
            sessions: [session({state: 'running'}, [baseItem({status: 'running', file: null, fileUrl: null, elapsedMs: 1000 * Math.random()})])],
        });
        const {p} = panel([running(), running()]);
        await p.refresh();
        document.querySelector('[data-queue-action="cancel"]').focus();

        const calls = [];
        const focus = window.HTMLElement.prototype.focus;
        window.HTMLElement.prototype.focus = function (opts) {
            calls.push(opts);
            return focus.call(this, opts);
        };
        try {
            await p.refresh();
        } finally {
            window.HTMLElement.prototype.focus = focus;
        }
        assert.deepEqual(calls, [{preventScroll: true}]);
        assert.equal(document.activeElement.dataset.queueAction, 'cancel');
    });

    test('shows a batch run\'s row and values under its name', async () => {
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [session({}, [baseItem({row: 3, vars: {date: '2026-03-01', build: 2310}})])]}]);
        await p.refresh();
        const notes = [...document.querySelectorAll('tbody th .queue-note')].map((n) => n.textContent);
        assert.deepEqual(notes, ['https://example.com/v2.3', 'Workflow 3 · date: 2026-03-01 · build: 2310']);
        assert.equal(mod.describeRow({}), null);
    });

    test('send to compare is offered once a session has a saved result, and hands over the session', async () => {
        const sent = [];
        const waiting = baseItem({status: 'waiting', file: null, fileUrl: null});
        const {p} = panel([
            {concurrency: 1, maxConcurrency: 4, sessions: [session({state: 'running'}, [waiting])]},
            {concurrency: 1, maxConcurrency: 4, sessions: [session()]},
        ], {onSendToCompare: (s) => sent.push(s.id)});
        await p.refresh();
        assert.equal(document.querySelector('[data-queue-action="compare"]'), null);
        await p.refresh();
        document.querySelector('[data-queue-action="compare"]').click();
        assert.deepEqual(sent, ['2026-10-12T14-03-27']);
    });

    test('earlier batches are collapsed: their heading and summary show, their runs wait behind the toggle', async () => {
        const old = session({id: '2026-10-11T08-00-00', startedAt: '2026-10-11T08:00:00.000Z'});
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [old]}]);
        await p.refresh();
        const toggle = document.querySelector('.queue-session-toggle');
        const body = document.getElementById(toggle.getAttribute('aria-controls'));
        assert.equal(toggle.closest('h3') !== null, true, 'the toggle is the heading');
        assert.equal(toggle.getAttribute('aria-expanded'), 'false');
        assert.equal(body.hidden, true);
        assert.match(document.querySelector('.queue-session-meta').textContent, /^Finished · 1 run/);

        toggle.click();
        const reopened = document.querySelector('.queue-session-toggle');
        assert.equal(reopened.getAttribute('aria-expanded'), 'true');
        assert.equal(document.getElementById(reopened.getAttribute('aria-controls')).hidden, false);
        assert.equal(document.activeElement, reopened, 'focus stays on the toggle after it re-renders');

        await p.refresh();
        assert.equal(document.querySelector('.queue-session-toggle').getAttribute('aria-expanded'), 'true', 'and stays open across refreshes');
    });

    test('a running batch has a spinner right after "Running", open or folded; a finished one has none', async () => {
        const items = [
            baseItem({id: 'a', status: 'running', scans: 1, durationMs: null, elapsedMs: 3000, file: null, fileUrl: null, findings: null}),
            baseItem({id: 'b', status: 'waiting', scans: null, durationMs: null, file: null, fileUrl: null, findings: null}),
        ];
        const old = session({id: '2026-10-11T08-00-00', startedAt: '2026-10-11T08:00:00.000Z'});
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [session({state: 'running'}, items), old]}]);
        await p.refresh();
        const meta = (i) => document.querySelectorAll('.queue-session')[i].querySelector('.queue-session-meta');
        const check = (when) => {
            const spinner = meta(0).querySelector('.queue-spinner');
            assert.ok(spinner, `${when}: the running batch has one`);
            assert.equal(spinner.previousSibling.textContent, 'Running', `${when}: right after the word`);
            assert.equal(spinner.getAttribute('aria-hidden'), 'true', 'a cue only: the words say it is running');
            assert.equal(meta(0).textContent, 'Running · 0 of 2 finished · 1 waiting', 'and the line reads as before');
            assert.equal(meta(1).querySelector('.queue-spinner'), null, `${when}: the finished batch has none`);
        };

        assert.equal(document.querySelector('.queue-session-toggle').getAttribute('aria-expanded'), 'true');
        check('open');
        document.querySelector('.queue-session-toggle').click();
        assert.equal(document.querySelector('.queue-session-toggle').getAttribute('aria-expanded'), 'false');
        check('folded');
    });

    test('a batch is headed by its scenario name before when it started, and named so wherever it is referred to', async () => {
        const asked = [];
        const {p, server} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [session({name: 'Web Banking', zipName: 'Web-Banking-queue-2026-10-12T14-03-27.zip'}), session({id: 'b', name: null})]}], {
            confirmDelete: (msg) => { asked.push(msg); return true; },
        });
        await p.refresh();
        const [named, unnamed] = document.querySelectorAll('.queue-session-toggle');
        const zips = [...document.querySelectorAll('a[download$=".zip"]')].map((a) => a.getAttribute('download'));
        assert.deepEqual(zips, ['Web-Banking-queue-2026-10-12T14-03-27.zip', 'queue-b.zip'], 'the zip carries the server\'s name, or the plain one');
        assert.match(named.textContent, /^Web Banking – Queue started \S/);
        assert.match(unnamed.textContent, /^Queue started \S/, 'unchanged without a name');
        named.click();
        assert.match(document.querySelector('.queue-table caption').textContent, /^Runs in Web Banking – Queue started /);
        const del = document.querySelector('[data-queue-action="delete"]');
        assert.match(del.textContent, /^Delete the batch Web Banking, started /);
        del.click();
        assert.match(asked[0], /^Delete the batch Web Banking, started .+\? /);
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(server.posts[0].url, '/queue/sessions/2026-10-12T14-03-27/delete');
        assert.match(document.getElementById('status').textContent, /^Deleted the batch Web Banking, started /);
    });

    test('add sends the batch\'s scenario name with its runs', async () => {
        const {p, server} = panel([{concurrency: 1, maxConcurrency: 4, sessions: []}]);
        await p.add([{run: {url: 'https://x.test/'}}], {name: 'Web Banking'});
        assert.equal(server.posts[0].url, '/queue/items');
        assert.equal(server.posts[0].body.name, 'Web Banking');
    });

    test('a running batch is open, and stays open when it finishes; closing it by hand sticks', async () => {
        const running = session({state: 'running'}, [baseItem({status: 'running', file: null, fileUrl: null})]);
        const done = session({state: 'finished'}, [baseItem()]);
        const {p} = panel([
            {concurrency: 1, maxConcurrency: 4, sessions: [running]},
            {concurrency: 1, maxConcurrency: 4, sessions: [done]},
            {concurrency: 1, maxConcurrency: 4, sessions: [running]},
        ]);
        await p.refresh();
        assert.equal(document.querySelector('.queue-session-toggle').getAttribute('aria-expanded'), 'true');
        await p.refresh();
        assert.equal(document.querySelector('.queue-session-toggle').getAttribute('aria-expanded'), 'true', 'finished, still open');
        document.querySelector('.queue-session-toggle').click();
        await p.refresh();
        assert.equal(document.querySelector('.queue-session-toggle').getAttribute('aria-expanded'), 'false', 'closed by hand stays closed');
    });

    test('delete is offered on finished batches only, asks first, and does nothing when declined', async () => {
        const asked = [];
        let answer = false;
        const running = session({id: '2026-10-12T15-00-00', state: 'running'}, [baseItem({id: 'r', status: 'running', file: null, fileUrl: null})]);
        const {p, server} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [running, session()]}], {
            confirmDelete: (msg) => { asked.push(msg); return answer; },
        });
        await p.refresh();
        const deletes = [...document.querySelectorAll('[data-queue-action="delete"]')].map((b) => b.dataset.sessionId);
        assert.deepEqual(deletes, ['2026-10-12T14-03-27']);
        const button = document.querySelector('[data-queue-action="delete"]');
        assert.match(button.textContent, /^Delete the batch started /, 'named for screen readers');

        button.click();
        assert.match(asked[0], /^Delete the batch started .+\? Its 1 saved result and batch\.json are removed from the server\. This cannot be undone\.$/);
        assert.equal(server.posts.length, 0);

        answer = true;
        button.click();
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(server.posts[0].url, '/queue/sessions/2026-10-12T14-03-27/delete');
        assert.match(document.getElementById('status').textContent, /^Deleted the batch started /);
    });

    test('after a delete, focus moves to the first remaining batch', async () => {
        const kept = session({id: '2026-10-10T08-00-00', startedAt: '2026-10-10T08:00:00.000Z'});
        const {p} = panel([
            {concurrency: 1, maxConcurrency: 4, sessions: [session(), kept]},
            {concurrency: 1, maxConcurrency: 4, sessions: [kept]},
        ], {confirmDelete: () => true});
        await p.refresh();
        document.querySelector('.queue-session-toggle').click(); // open the first, to reach its Delete
        const del = document.querySelector('[data-queue-action="delete"][data-session-id="2026-10-12T14-03-27"]');
        del.focus();
        del.click();
        await new Promise((r) => setTimeout(r, 10));
        assert.equal(document.activeElement.dataset.focusKey, 'session:2026-10-10T08-00-00');
    });

    test('a running row offers Watch, and hands the run and its session over', async () => {
        const watched = [];
        const items = [
            baseItem({id: 'r', status: 'running', file: null, fileUrl: null}),
            baseItem({id: 'w', status: 'waiting', file: null, fileUrl: null}),
        ];
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [session({state: 'running'}, items)]}], {
            onWatch: (item, s) => watched.push([item.id, s.id]),
        });
        await p.refresh();
        const watch = [...document.querySelectorAll('[data-queue-action="watch"]')];
        assert.deepEqual(watch.map((b) => b.dataset.itemId), ['r'], 'only the running row');
        assert.equal(watch[0].textContent, 'Watch Product v2.3');
        watch[0].click();
        assert.deepEqual(watched, [['r', '2026-10-12T14-03-27']]);
    });

    test('a waiting row keeps an empty place for Watch, so its Cancel lines up with a running row\'s', async () => {
        const items = [
            baseItem({id: 'r', status: 'running', file: null, fileUrl: null}),
            baseItem({id: 'w', status: 'waiting', file: null, fileUrl: null}),
        ];
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [session({state: 'running'}, items)]}]);
        await p.refresh();
        const shape = (id) => [...document.querySelector(`[data-queue-action="cancel"][data-item-id="${id}"]`).parentElement.children]
            .map((c) => c.dataset.queueAction || c.className);
        assert.deepEqual(shape('r'), ['watch', 'cancel']);
        assert.deepEqual(shape('w'), ['queue-icon-slot', 'cancel']);
        assert.equal(document.querySelector('.queue-icon-slot').getAttribute('aria-hidden'), 'true');
    });

    test('says when a batch starts and stops running, for the tab spinner', async () => {
        const changes = [];
        const running = session({state: 'running'}, [baseItem({status: 'running', file: null, fileUrl: null})]);
        const {p} = panel([
            {concurrency: 1, maxConcurrency: 4, sessions: [running]},
            {concurrency: 1, maxConcurrency: 4, sessions: [running]},
            {concurrency: 1, maxConcurrency: 4, sessions: [session()]},
        ], {onRunningChange: (r) => changes.push(r)});
        await p.refresh();
        await p.refresh();
        await p.refresh();
        assert.deepEqual(changes, [true, false], 'once each way');
    });

    test('keeps polling in the background while a batch runs, even with the tab hidden', async () => {
        let gets = 0;
        const running = session({state: 'running'}, [baseItem({status: 'running', file: null, fileUrl: null})]);
        const p = mod.createRunQueuePanel({
            listEl: document.getElementById('list'),
            statusEl: document.getElementById('status'),
            // Running for two polls, finished on the third, which ends the polling.
            fetchImpl: async () => {
                gets += 1;
                const sessions = [gets < 3 ? running : session()];
                return {ok: true, status: 200, json: async () => ({concurrency: 1, maxConcurrency: 4, sessions})};
            },
            pollMs: 60000,
            hiddenPollMs: 5,
        });
        await p.refresh(); // tab never shown
        await until(() => gets >= 3, 'three polls');
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(gets, 3, 'stops once the batch has finished');
    });

    test('lowering runs at the same time below what is running says the running ones finish first', async () => {
        const running = (id) => baseItem({id, status: 'running', file: null, fileUrl: null});
        const live = session({state: 'running'}, [running('a'), running('b'), running('c'), running('d'), baseItem({id: 'e', status: 'waiting', file: null, fileUrl: null})]);
        const {p, server} = panel([{concurrency: 4, maxConcurrency: 4, sessions: [live]}]);
        await p.refresh();
        const select = document.getElementById('c');

        select.value = '2';
        select.dispatchEvent(new window.Event('change'));
        await new Promise((r) => setTimeout(r, 0));
        assert.deepEqual(server.posts.at(-1), {url: '/queue/settings', body: {concurrency: 2}});
        assert.equal(document.getElementById('status').textContent,
            'Up to 2 runs at the same time. The 4 running now will finish first; new workflows start once fewer than 2 are running.');

        select.value = '4';
        select.dispatchEvent(new window.Event('change'));
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(document.getElementById('status').textContent, 'Up to 4 runs at the same time.');
    });

    test('a running row shows a spinner beside its status, and its counts as plain numbers', async () => {
        const runningItem = baseItem({
            status: 'running', scans: 2, file: null, fileUrl: null,
            findings: {fail: 8, cantTell: 1, pass: 40, soFar: true},
        });
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [session({state: 'running'}, [runningItem])]}]);
        await p.refresh();
        const cells = [...document.querySelector('tbody tr').children];
        const spinner = cells[1].querySelector('.queue-spinner');
        assert.ok(spinner);
        assert.equal(spinner.getAttribute('aria-hidden'), 'true');
        assert.equal(cells[1].textContent, 'Running');
        assert.equal(cells[3].textContent, '8');
        assert.equal(cells[4].textContent, '1');
        assert.equal(cells[5].textContent, '40');
    });

    test('reads the findings count of batches saved before it was renamed', async () => {
        const old = baseItem({findings: {failRules: 6, failInstances: 332, cantTellRules: 72, cantTellInstances: 222}});
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [session({}, [old])]}]);
        await p.refresh();
        const cells = [...document.querySelector('tbody tr').children].map(accessibleText);
        assert.deepEqual(cells.slice(3, 6), ['6', '72', '']);
    });

    test('leaves the counts empty until a scan has finished', async () => {
        const starting = baseItem({
            status: 'running', scans: 0, file: null, fileUrl: null,
            findings: {fail: 0, cantTell: 0, pass: 0, soFar: true},
        });
        const failedEarly = baseItem({id: 'i2', status: 'error', scans: 0, file: null, fileUrl: null,
            findings: {fail: 0, cantTell: 0, pass: 0}});
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [session({state: 'running'}, [starting, failedEarly])]}]);
        await p.refresh();
        for (const row of document.querySelectorAll('tbody tr')) {
            const cells = [...row.children].map((c) => c.textContent);
            assert.equal(cells[2], '0');
            assert.deepEqual(cells.slice(3, 6), ['', '', '']);
        }
    });

    test('a finished row has no spinner', async () => {
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [session()]}]);
        await p.refresh();
        assert.equal(document.querySelector('.queue-spinner'), null);
    });

    test('a running batch offers Download all and Send to Compare disabled, saying why; a finished one offers them', async () => {
        const running = session({state: 'running'}, [baseItem(), baseItem({id: 'r', status: 'running', file: null, fileUrl: null})]);
        const {p, server} = panel([
            {concurrency: 1, maxConcurrency: 4, sessions: [running]},
            {concurrency: 1, maxConcurrency: 4, sessions: [session()]},
        ], {onSendToCompare: () => { throw new Error('must not send while running'); }});
        await p.refresh();
        const zip = [...document.querySelectorAll('.queue-session-actions > *')].find((b) => b.textContent === 'Download all (zip)');
        const compare = [...document.querySelectorAll('.queue-session-actions > *')].find((b) => b.textContent === 'Send to Compare');
        assert.equal(zip.tagName, 'BUTTON', 'no link to follow while running');
        assert.equal(zip.getAttribute('aria-disabled'), 'true');
        assert.equal(compare.getAttribute('aria-disabled'), 'true');

        zip.click();
        assert.match(document.getElementById('status').textContent, /^Available once this batch finishes/);
        compare.click();
        assert.equal(server.posts.length, 0);

        await p.refresh();
        const doneZip = document.querySelector('.queue-session-actions a[href$="download.zip"]');
        assert.ok(doneZip, 'a real link once finished');
        assert.equal(document.querySelector('[data-queue-action="compare"]').hasAttribute('aria-disabled'), false);
    });

    test('Resume waits while another batch runs, saying why', async () => {
        const running = session({id: '2026-10-12T15-00-00', state: 'running'}, [baseItem({id: 'r', status: 'running', file: null, fileUrl: null})]);
        const interrupted = session({state: 'interrupted', resumable: true}, [baseItem({status: 'interrupted', file: null, fileUrl: null})]);
        const {p, server} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [running, interrupted]}]);
        await p.refresh();
        const resume = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Resume');
        assert.equal(resume.getAttribute('aria-disabled'), 'true');
        resume.click();
        assert.equal(document.getElementById('status').textContent, 'Another batch is running. Resume this one once it has finished.');
        assert.equal(server.posts.length, 0);
    });

    test('formatDuration', () => {
        assert.equal(mod.formatDuration(0), '0s');
        assert.equal(mod.formatDuration(59400), '59s');
        assert.equal(mod.formatDuration(61000), '1m 01s');
        assert.equal(mod.formatDuration(3_725_000), '1h 02m');
        assert.equal(mod.formatDuration(null), '');
    });
});

describe('passwordsFromWorkflow', () => {
    const field = (key, path, step) => ({key, match: {path, field: 'value', step: {valueMasked: true, ...step}}});

    test('fills a field from the step at the same place with the same settings', () => {
        const found = mod.passwordsFromWorkflow(
            [field('k1', ['actions', 0], {type: 'setPassword', selector: '#pass'})],
            {actions: [{type: 'setPassword', selector: '#pass', value: 'hunter2', valueMasked: true, collapsed: true}]}
        );
        assert.deepEqual(found, {k1: 'hunter2'});
    });

    test('finds the step elsewhere in the workflow, and in custom steps', () => {
        const found = mod.passwordsFromWorkflow(
            [
                field('k1', ['actions', 0], {type: 'setPassword', selector: '#pass'}),
                field('k2', ['customSteps', 0, 'actions', 0], {type: 'setPassword', labelText: 'PIN'}),
            ],
            {
                actions: [{type: 'goto'}, {type: 'setPassword', selector: '#pass', value: 'hunter2', valueMasked: true}],
                customSteps: [{name: 'Login', actions: [{type: 'setPassword', labelText: 'PIN', value: '4321', valueMasked: true}]}],
            }
        );
        assert.deepEqual(found, {k1: 'hunter2', k2: '4321'});
    });

    test('a step saved as a hidden setValue matches its setPassword step', () => {
        const found = mod.passwordsFromWorkflow(
            [field('k1', ['actions', 0], {type: 'setPassword', selector: '#pass'})],
            {actions: [{type: 'setValue', selector: '#pass', value: 'hunter2', valueMasked: true}]}
        );
        assert.deepEqual(found, {k1: 'hunter2'});
    });

    test('falls back to the same field selector when other settings changed', () => {
        const found = mod.passwordsFromWorkflow(
            [field('k1', ['actions', 0], {type: 'setPassword', selector: '#pass'})],
            {actions: [{type: 'setPassword', selector: ' #pass ', exact: true, value: 'hunter2', valueMasked: true}]}
        );
        assert.deepEqual(found, {k1: 'hunter2'});
    });

    test('leaves a field out when the editor has no single answer for it', () => {
        const fields = [field('k1', ['actions', 5], {type: 'setPassword', selector: '#pass'})];
        const twoDifferent = {actions: [
            {type: 'setPassword', selector: '#pass', value: 'a', valueMasked: true},
            {type: 'setPassword', selector: '#pass', value: 'b', valueMasked: true},
        ]};
        assert.deepEqual(mod.passwordsFromWorkflow(fields, twoDifferent), {});
        assert.deepEqual(mod.passwordsFromWorkflow(fields, {actions: [{type: 'setPassword', selector: '#pass', valueMasked: true}]}), {},
            'an empty password is not an answer');
        assert.deepEqual(mod.passwordsFromWorkflow(fields, {actions: [{type: 'setPassword', selector: '#other', value: 'x', valueMasked: true}]}), {});
        assert.deepEqual(mod.passwordsFromWorkflow(fields, null), {});
    });

    test('a step at the same place settles which of two different passwords it is', () => {
        const found = mod.passwordsFromWorkflow(
            [field('k1', ['actions', 1], {type: 'setPassword', selector: '#pass'})],
            {actions: [
                {type: 'setPassword', selector: '#pass', value: 'a', valueMasked: true},
                {type: 'setPassword', selector: '#pass', value: 'b', valueMasked: true},
            ]}
        );
        assert.deepEqual(found, {k1: 'b'});
    });
});

describe('run queue panel: server memory and the governor', () => {
    const runningSession = () => session({state: 'running'}, [baseItem({status: 'running'}), baseItem({id: 'i2', name: 'Next', status: 'waiting'})]);
    const resources = {heapPct: 23.4, heapUsedMb: 960, heapLimitMb: 4096, at: '2026-10-21T10:00:00.000Z'};
    const hold = {reason: 'memory', heapPct: 63.2, holdAtPct: 60, resumeBelowPct: 50, since: '2026-10-21T10:00:00.000Z'};
    const healthLine = () => document.querySelector('.queue-session-health');

    test('a running batch shows the server memory under its status line', async () => {
        const {p} = panel([{concurrency: 2, maxConcurrency: 4, hold: null, resources, sessions: [runningSession()]}]);
        await p.refresh();
        assert.equal(healthLine().textContent, 'Server memory: 23% of its 4.0 GB limit.');
        assert.equal(healthLine().classList.contains('queue-session-health--held'), false);
        assert.equal(healthLine().previousElementSibling.className, 'queue-session-meta');
    });

    test('a held next run says why, and when it will start', async () => {
        const {p} = panel([{concurrency: 2, maxConcurrency: 4, hold, resources: {...resources, heapPct: 63.2}, sessions: [runningSession()]}]);
        await p.refresh();
        assert.equal(healthLine().textContent, 'Holding the next run while server memory is high: 63% of its 4.0 GB limit. '
            + 'It starts once memory is below 50%; the runs already going carry on.');
        assert.ok(healthLine().classList.contains('queue-session-health--held'));
    });

    test('no line before the first reading, or on a finished batch', async () => {
        const {p} = panel([
            {concurrency: 2, maxConcurrency: 4, hold: null, resources: null, sessions: [runningSession()]},
            {concurrency: 2, maxConcurrency: 4, hold: null, resources, sessions: [session()]},
        ]);
        await p.refresh();
        assert.equal(healthLine(), null);
        await p.refresh();
        assert.equal(healthLine(), null);
    });

    test('announces the hold and its end, but not a hold dropped as the batch ends', async () => {
        const status = () => document.getElementById('status').textContent;
        const state = (h, sessions = [runningSession()]) => ({concurrency: 2, maxConcurrency: 4, hold: h, resources, sessions});
        const {p} = panel([state(null), state(hold), state(null), state(hold), state(null, [session()])]);
        await p.refresh();
        await p.refresh();
        assert.equal(status(), 'Holding the next run while server memory is high.');
        await p.refresh();
        assert.equal(status(), 'Server memory is back down: the next run can start.');
        await p.refresh();
        await p.refresh();
        assert.equal(status(), 'Product v2.3: done.', 'the run that finished, and nothing about memory');
    });

    test('describeHealth sizes the limit, and copes with no limit known', () => {
        assert.equal(mod.describeHealth({resources: {heapPct: 9.6, heapLimitMb: 900}}), 'Server memory: 10% of its 900 MB limit.');
        assert.equal(mod.describeHealth({resources: {heapPct: 9.6}}), 'Server memory: 10% of its limit.');
        assert.equal(mod.describeHealth({}), '');
    });
});

describe('run queue panel: a running run, and feedback while away', () => {
    const live = (over = {}) => baseItem({status: 'running', durationMs: null, elapsedMs: 60000, file: null, fileUrl: null,
        phase: 'running', activity: 'Repeat 34 of 120 › A11y scan “Home”', sinceScanMs: 12000, sinceProgressMs: 3000, ...over});
    const running = (items) => ({concurrency: 2, maxConcurrency: 4, hold: null, resources: null, sessions: [session({state: 'running', name: 'Checkout'}, items)]});
    const statusCellText = () => accessibleText(document.querySelector('.queue-status'));

    test('a running row keeps to its status: what it is on is for the Watch dialog', async () => {
        const {p} = panel([running([live()])]);
        await p.refresh();
        assert.equal(statusCellText(), 'Running');
        assert.equal(document.querySelector('.queue-stall'), null);
        assert.equal(document.querySelectorAll('tbody tr')[0].children[2].querySelector('.queue-note'), null, 'no pace while it runs');
    });

    test('flags a run that has logged nothing for five minutes with a sign, named for screen readers', async () => {
        const {p} = panel([running([live({sinceScanMs: 400000, sinceProgressMs: mod.STALL_MS + 2000})])]);
        await p.refresh();
        const stall = document.querySelector('.queue-stall');
        assert.equal(stall.getAttribute('title'), 'No progress for over 5 minutes. Watch the run for details.');
        assert.equal(stall.querySelector('svg').getAttribute('aria-hidden'), 'true');
        assert.equal(statusCellText(), 'Running No progress for over 5 minutes. Watch the run for details.');
    });

    test('describeRunNow: the step, the last scan and pace, and a stall in words', () => {
        assert.deepEqual(mod.describeRunNow({activity: 'Repeat 34 of 120 › A11y scan “Home”', sinceScanMs: 12000, sinceProgressMs: 3000, paceMs: 9000}),
            {step: 'Repeat 34 of 120 › A11y scan “Home”', liveness: 'Last scan 12s ago · 1 every 9.0s', stall: ''});
        assert.deepEqual(mod.describeRunNow({}), {step: 'Starting', liveness: 'No scan yet', stall: ''});
        assert.equal(mod.describeRunNow({phase: 'saving', sinceProgressMs: mod.STALL_MS * 2}).step, 'Building and writing the result');
        assert.equal(mod.describeRunNow({phase: 'saving', sinceProgressMs: mod.STALL_MS * 2}).stall, '', 'saving logs nothing, and is not stuck');
        assert.equal(mod.describeRunNow({sinceProgressMs: mod.STALL_MS + 2000}).stall,
            'No progress for 5m 02s: it may be on a long wait, or stuck on a page.');
    });

    test('says when a run is saving its result, without its step', async () => {
        const {p} = panel([running([live({phase: 'saving'})])]);
        await p.refresh();
        assert.equal(statusCellText(), 'Saving result');
    });

    test('a finished run shows none of it', async () => {
        const {p} = panel([{concurrency: 1, maxConcurrency: 4, sessions: [session({}, [baseItem({activity: 'x', sinceScanMs: 1})])]}]);
        await p.refresh();
        assert.equal(statusCellText(), 'Done');
    });

    test('the page title carries a running batch\'s progress, and that it finished until it is seen', async () => {
        document.title = 'Accessibility lab';
        const counts = (done) => ({concurrency: 2, maxConcurrency: 4, sessions: [session({state: 'running'},
            [baseItem({status: done ? 'done' : 'running'}), baseItem({id: 'i2', status: 'running'})])]});
        const {p} = panel([counts(false), counts(true), {concurrency: 2, maxConcurrency: 4, sessions: [session({}, [baseItem(), baseItem({id: 'i2'})])]}]);
        await p.refresh();
        assert.equal(document.title, '(0/2) Accessibility lab');
        await p.refresh();
        assert.equal(document.title, '(1/2) Accessibility lab');
        await p.refresh();
        assert.equal(document.title, 'Batch finished · Accessibility lab', 'finished while the queue tab was not shown');
        p.setVisible(true);
        assert.equal(document.title, 'Accessibility lab');
    });

    test('a batch that finishes with the queue tab on screen leaves the title as it was', async () => {
        document.title = 'Accessibility lab';
        const {p} = panel([running([live()]), {concurrency: 2, maxConcurrency: 4, sessions: [session()]}]);
        p.setVisible(true);
        await until(() => document.title.startsWith('('), 'the running title');
        await p.refresh();
        assert.equal(document.title, 'Accessibility lab');
    });

    function fakeNotifications(permission, answer = permission) {
        const shown = [];
        function N(title, opts) { shown.push({title, ...opts}); }
        N.permission = permission;
        N.requestPermission = async () => { N.permission = answer; return answer; };
        return {N, shown};
    }

    function memoryStorage() {
        const m = new Map();
        return {getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v))};
    }

    function notifyBox() {
        const label = document.createElement('label');
        label.hidden = true;
        const box = document.createElement('input');
        box.type = 'checkbox';
        label.append(box, ' Notify me when a batch finishes');
        document.body.append(label);
        return box;
    }

    async function toggle(box) {
        box.checked = !box.checked;
        box.dispatchEvent(new window.Event('change'));
        await new Promise((r) => setTimeout(r, 0));
    }

    test('the notify choice shows only where the browser can notify', () => {
        const box = notifyBox();
        panel([], {notifyToggle: box, notifications: null, storage: memoryStorage()});
        assert.equal(box.closest('label').hidden, true);
        const other = notifyBox();
        panel([], {notifyToggle: other, notifications: fakeNotifications('default').N, storage: memoryStorage()});
        assert.equal(other.closest('label').hidden, false);
    });

    test('turning it on asks the browser, and a refusal turns it back off and says how to allow it', async () => {
        const box = notifyBox();
        const storage = memoryStorage();
        panel([], {notifyToggle: box, notifications: fakeNotifications('default', 'denied').N, storage});
        await toggle(box);
        assert.equal(box.checked, false);
        assert.match(document.getElementById('status').textContent, /does not allow notifications/);
        assert.equal(storage.getItem('a11y-queue-notify'), 'off');
    });

    test('notifies when a batch finishes while the page is not on screen', async () => {
        const box = notifyBox();
        const {N, shown} = fakeNotifications('default', 'granted');
        const finished = session({name: 'Checkout'}, [baseItem(), baseItem({id: 'i2', status: 'error'})]);
        const {p} = panel([running([live(), live({id: 'i2'})]), {concurrency: 2, maxConcurrency: 4, sessions: [finished]}],
            {notifyToggle: box, notifications: N, storage: memoryStorage()});
        await toggle(box);
        assert.equal(box.checked, true);
        await p.refresh();
        Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
        try {
            await p.refresh();
        } finally {
            delete document.hidden;
        }
        assert.deepEqual(shown.map((n) => [n.title, n.body]), [['Batch finished', 'Checkout: Finished · 2 runs · 1 failed. 8 scans · slowest: Product v2.3 (1m 05s)']]);
    });

    test('no notification while the page is on screen, or when not chosen', async () => {
        const {N, shown} = fakeNotifications('granted');
        const {p} = panel([running([live()]), {concurrency: 2, maxConcurrency: 4, sessions: [session()]}],
            {notifyToggle: notifyBox(), notifications: N, storage: memoryStorage()});
        await p.refresh();
        Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
        try {
            await p.refresh();
        } finally {
            delete document.hidden;
        }
        assert.equal(shown.length, 0, 'not chosen');
    });
});

describe('run queue panel: pace and the batch in a line', () => {
    test('a finished run shows its average pace; a running, saving or failed one none', async () => {
        const items = [
            baseItem({id: 'a', status: 'running', durationMs: null, elapsedMs: 1000, scans: 30, scansRun: 30, paceMs: 9000, phase: 'running'}),
            baseItem({id: 'b', status: 'running', durationMs: null, elapsedMs: 1000, scans: 30, scansRun: 30, paceMs: 9000, phase: 'saving'}),
            baseItem({id: 'c', scans: 10, scansRun: 10, durationMs: 125000}),
            baseItem({id: 'd', status: 'error', scans: 10, scansRun: 10, durationMs: 125000}),
        ];
        const {p} = panel([{concurrency: 2, maxConcurrency: 4, sessions: [session({state: 'running', scansPerMin: 7}, items)]}]);
        await p.refresh();
        const pace = [...document.querySelectorAll('tbody tr')].map((r) => [...r.children[2].querySelectorAll('.queue-note')].map((n) => n.textContent).join());
        assert.deepEqual(pace, ['', '', '1 every 13s', ''], 'a failed run\'s pace would mislead');
        assert.equal(document.querySelector('.queue-session-meta').textContent, 'Running · 2 of 4 finished · about 7 scans a minute · 1 failed');
    });

    test('with Merged scans, the batch line also says how many scans a minute the report keeps', () => {
        const counts = {total: 7, running: 4, waiting: 3};
        assert.equal(mod.describeSession({state: 'running', counts, scansPerMin: 27, mergedScansPerMin: 9}),
            'Running · 0 of 7 finished · 3 waiting · about 27 scans a minute (9 after merging)');
        assert.equal(mod.describeSession({state: 'running', counts, scansPerMin: 27, mergedScansPerMin: null}),
            'Running · 0 of 7 finished · 3 waiting · about 27 scans a minute');
    });

    test('formatPace keeps tenths only where they matter', () => {
        assert.equal(mod.formatPace(850), '1 every 0.8s');
        assert.equal(mod.formatPace(9940), '1 every 9.9s');
        assert.equal(mod.formatPace(75000), '1 every 1m 15s');
        assert.equal(mod.formatPace(0), '');
    });

    test('a finished batch says how much it scanned, in how long, its slowest run and its memory', async () => {
        const finished = session({
            startedAt: '2026-10-21T08:00:00.000Z', finishedAt: '2026-10-21T10:10:00.000Z',
            stats: {peakHeapPct: 41.4, peakHeapMb: 1700, heapLimitMb: 4096, holds: 2},
        }, [
            baseItem({id: 'a', name: 'Checkout', scans: 2100, scansRun: 2112, durationMs: 6120000}),
            baseItem({id: 'b', name: 'Search', scans: 2100, scansRun: 2100, durationMs: 3600000}),
        ]);
        assert.equal(mod.describeSummary(finished),
            '4,212 scans in 2h 10m · slowest: Checkout (1h 42m) · server memory peaked at 41% of its 4.0 GB limit · held a run back for memory twice');
        const {p} = panel([{concurrency: 2, maxConcurrency: 4, sessions: [finished]}]);
        await p.refresh();
        assert.equal(document.querySelector('.queue-session-summary').textContent, mod.describeSummary(finished));
    });

    test('says only what it knows, and nothing on a running batch', async () => {
        assert.equal(mod.describeSummary(session({}, [baseItem({scans: 1, scansRun: 1})])), '1 scan');
        assert.equal(mod.describeSummary(session({stats: {peakHeapPct: 12, holds: 1}}, [])), 'server memory peaked at 12% · held a run back for memory once');
        assert.equal(mod.describeSummary(session({}, [])), '');
        const {p} = panel([{concurrency: 2, maxConcurrency: 4, sessions: [session({state: 'running'}, [baseItem({status: 'running'})])]}]);
        await p.refresh();
        assert.equal(document.querySelector('.queue-session-summary'), null);
    });
});

describe('run queue panel: noticing a batch started elsewhere', () => {
    const idle = {concurrency: 1, maxConcurrency: 4, sessions: []};
    const started = () => ({concurrency: 1, maxConcurrency: 4, sessions: [session({state: 'running'}, [baseItem({status: 'running'})])]});

    function countingServer(states) {
        const server = fakeServer(states);
        let gets = 0;
        const fetchImpl = (url, opts = {}) => {
            if ((opts.method || 'GET') === 'GET') gets += 1;
            return server.fetchImpl(url, opts);
        };
        return {fetchImpl, gets: () => gets};
    }

    test('with nothing running, a light poll finds a batch started from elsewhere', async () => {
        const running = [];
        const server = countingServer([idle, idle, started()]);
        const p = mod.createRunQueuePanel({
            listEl: document.getElementById('list'), statusEl: document.getElementById('status'),
            fetchImpl: server.fetchImpl, pollMs: 60000, idlePollMs: 10, onRunningChange: (r) => running.push(r),
        });
        await p.refresh();
        await until(() => running.length === 1, 'the batch to be noticed');
        assert.deepEqual(running, [true]);
        assert.match(document.getElementById('list').textContent, /Running/);
    });

    test('a page not on screen does no idle polling, and catches up when it is back', async () => {
        const server = countingServer([idle, started()]);
        Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
        let p;
        try {
            p = mod.createRunQueuePanel({
                listEl: document.getElementById('list'), statusEl: document.getElementById('status'),
                fetchImpl: server.fetchImpl, pollMs: 60000, idlePollMs: 5,
            });
            await p.refresh();
            await new Promise((r) => setTimeout(r, 40));
            assert.equal(server.gets(), 1, 'no poll while hidden and idle');
        } finally {
            delete document.hidden;
        }
        document.dispatchEvent(new window.Event('visibilitychange'));
        await until(() => /Running/.test(document.getElementById('list').textContent), 'the catch-up refresh');
    });
});


// GET /queue gives each batch in summary; its runs come from itemsUrl a page
// at a time, once it is open.
describe('run queue panel: a batch\'s runs, a page at a time', () => {
    function pagedServer(total) {
        const all = Array.from({length: total}, (_, i) => baseItem({id: `i${i}`, name: `Run ${i}`, file: `Run-${i}.json`}));
        const summary = {...session({finishedAt: '2026-10-12T15:00:00.000Z'}, []), items: undefined, counts: {total, done: total},
            itemsUrl: '/queue/sessions/2026-10-12T14-03-27/items', scans: total * 4, hasResults: true,
            slowest: {id: 'i3', name: 'Run 3', durationMs: 90000}, active: [], recent: []};
        delete summary.items;
        const asked = [];
        const fetchImpl = async (url) => {
            if (url.startsWith('/queue/sessions/')) {
                const q = new URL(url, 'http://x').searchParams;
                const offset = Number(q.get('offset')), limit = Number(q.get('limit'));
                asked.push(limit);
                return {ok: true, status: 200, json: async () => ({total, offset, limit, items: all.slice(offset, offset + limit)})};
            }
            return {ok: true, status: 200, json: async () => ({concurrency: 1, maxConcurrency: 4, sessions: [JSON.parse(JSON.stringify(summary))]})};
        };
        return {fetchImpl, asked};
    }

    test('a closed batch reads none of its runs; opened, it shows the first page and offers the next', async () => {
        const server = pagedServer(250);
        const p = mod.createRunQueuePanel({listEl: document.getElementById('list'), statusEl: document.getElementById('status'), fetchImpl: server.fetchImpl, pollMs: 60000});
        await p.refresh();
        assert.deepEqual(server.asked, []);
        assert.match(document.querySelector('.queue-session-summary').textContent, /1,000 scans in .* · slowest: Run 3 \(1m 30s\)/);

        document.querySelector('[data-queue-action="toggle"]').click();
        await until(() => document.querySelectorAll('.queue-table tbody tr[data-item-id], .queue-table tbody th').length >= 100, 'the first page');
        assert.equal(document.querySelectorAll('.queue-table tbody tr:not(.queue-items-more)').length, 100);
        assert.match(document.querySelector('.queue-items-more').textContent, /Showing 100 of 250 runs\. Show 100 more/);

        document.querySelector('[data-queue-action="more"]').click();
        await until(() => document.querySelectorAll('.queue-table tbody tr:not(.queue-items-more)').length === 200, 'the second page');
        assert.match(document.querySelector('.queue-items-more').textContent, /Show 50 more/);
        assert.deepEqual(server.asked, [100, 200]);
        assert.match(document.getElementById('status').textContent, /Showing 200 of 250 runs/);
    });
});

describe('changing a finished batch', () => {
    const finished = (items) => ({concurrency: 1, maxConcurrency: 8, sessions: [session({finishedAt: '2026-10-12T15:00:00.000Z'}, items)]});
    const button = (text) => [...document.querySelectorAll('#list button')].find((b) => b.textContent.trim().startsWith(text) || b.title === text);
    const status = () => document.getElementById('status').textContent;

    const later = {status: 'done', scans: 4, findings: {fail: 2, cantTell: 70, pass: 140}, durationMs: 60000,
        finishedAt: '2026-11-07T09:15:02.000Z', file: 'Product-v2.3-2.json', fileUrl: '/reports/batches/S/Product-v2.3-2.json',
        zipUrl: '/queue/sessions/S/items/i1/download.zip?file=Product-v2.3-2.json', ranAgain: true};

    test('running again, a row shows its active result above the run, its name spanning both', async () => {
        const {p} = panel([{concurrency: 1, maxConcurrency: 8, sessions: [session({state: 'running'}, [
            baseItem({status: 'running', scans: 1, findings: {fail: 1, cantTell: 3, pass: 9}, startedAt: '2026-11-07T09:14:00.000Z', elapsedMs: 3000,
                active: {status: 'done', scans: 4, findings: {fail: 6, cantTell: 72, pass: 138}, durationMs: 65000, finishedAt: '2026-11-06T11:33:37.000Z',
                    file: 'Product-v2.3.json', fileUrl: '/reports/batches/S/Product-v2.3.json', ranAgain: false}}),
        ])]}]);
        await p.refresh();
        const [activeLine, runLine] = document.querySelectorAll('#list tbody tr');
        assert.equal(activeLine.querySelector('th').getAttribute('rowspan'), '2');
        assert.equal(runLine.querySelector('th'), null, 'the name spans both lines');
        assert.equal(activeLine.querySelector('.queue-line-tag').textContent, 'Active');
        assert.equal(runLine.querySelector('.queue-line-tag').textContent, 'Run again');
        assert.match(activeLine.querySelector('.queue-fail').textContent, /^6/);
        assert.match(runLine.querySelector('.queue-fail').textContent, /^1/);
        assert.match(runLine.querySelector('time').textContent, /^Started 7 Nov 2026/);
        assert.ok(activeLine.querySelector('[title="Open"]'), 'the active result opens');
        assert.ok(runLine.querySelector('[title="Watch"]'), 'the run is watched');
        assert.equal(document.querySelector('#list [title="Run again"]'), null);
    });

    test('a re-run\'s result waits under the active one, with a line to choose; Run again and Delete wait for the choice', async () => {
        const {p, server} = panel([finished([baseItem({finishedAt: '2026-11-06T11:33:37.000Z', candidate: later}), baseItem({id: 'i2', name: 'Second'})])]);
        await p.refresh();
        const lines = [...document.querySelectorAll('#list tbody tr')].slice(0, 3);
        assert.equal(lines[0].querySelector('th').getAttribute('rowspan'), '3');
        assert.deepEqual(lines.slice(0, 2).map((l) => l.querySelector('.queue-line-tag').textContent), ['Active', 'Run again']);
        assert.deepEqual([...lines[1].querySelectorAll('.queue-was')].map((w) => [w.textContent, w.className.includes('better') ? 'better' : w.className.includes('worse') ? 'worse' : '']),
            [['was 4', ''], ['was 6', 'better'], ['was 72', ''], ['was 138', 'better']]);
        assert.match(lines[2].textContent, /Run again finished: 2 failing, 4 fewer than the active result; same 4 scans\./);
        const links = [...lines[2].querySelectorAll('[data-queue-action="keep"]')];
        assert.deepEqual(links.map((l) => l.textContent), ['the new one for Product v2.3 (suggested)', 'the active one for Product v2.3', 'both for Product v2.3']);
        assert.ok(links[0].classList.contains('queue-link--suggested'));
        assert.equal(lines[0].querySelector('[title="Run again"]'), null, 'no Run again until the choice');
        assert.equal(lines[0].querySelector('[title="Delete"]'), null);
        assert.ok(document.querySelector('tr[data-item-id="i2"] [title="Delete"]'), 'the other rows keep theirs');

        links[2].click();
        await until(() => server.posts.length, 'the choice');
        assert.deepEqual([server.posts[0].url, server.posts[0].body], ['/queue/sessions/2026-10-12T14-03-27/items/i1/keep', {keep: 'both'}]);
        await until(() => /keeps both results/.test(document.getElementById('status').textContent), 'what it says');
    });

    test('a re-run that did not finish suggests keeping the active result, and says why', () => {
        const choice = mod.describeChoice(baseItem(), {...later, status: 'error', scans: 1});
        assert.deepEqual([choice.warn, choice.suggest], ['Run again did not finish:', 'active']);
        assert.match(choice.text, /1 scan of 4; its counts are not comparable/);
    });

    test('a row with versions opens them under it: the active one marked, the others made active or deleted', async () => {
        const asked = [];
        const {p, server} = panel([finished([baseItem({finishedAt: '2026-11-06T11:33:37.000Z', versions: [later]})])], {
            confirmDelete: (msg) => { asked.push(msg); return true; },
        });
        await p.refresh();
        const toggle = button('2 versions');
        assert.equal(toggle.getAttribute('aria-expanded'), 'false');
        assert.equal(toggle.querySelector('.visually-hidden').textContent, ' of Product v2.3');
        toggle.click();
        const rows = [...document.querySelectorAll('#list tbody tr')];
        assert.equal(rows.length, 3);
        assert.equal(rows[0].querySelector('th').getAttribute('rowspan'), '3');
        assert.equal(document.activeElement.getAttribute('data-focus-key'), 'versions:i1');
        assert.equal(rows[1].querySelector('.queue-line-tag').textContent, 'Active', 'the first run, active');
        assert.equal(rows[2].querySelector('.queue-line-tag'), null);
        assert.ok(rows[2].querySelector('[title="Open"]'));
        assert.match(rows[2].textContent, /Ran again/);
        rows[2].querySelector('[data-queue-action="activate-version"]').click();
        await until(() => server.posts.length, 'made active');
        assert.deepEqual([server.posts[0].url, server.posts[0].body], ['/queue/sessions/2026-10-12T14-03-27/items/i1/versions/activate', {file: 'Product-v2.3-2.json'}]);
        await until(() => !document.querySelector('[data-queue-action="activate-version"][data-busy="true"]'), 'done');
        document.querySelector('[data-queue-action="delete-version"]').click();
        await until(() => server.posts.length === 2, 'deleted');
        assert.match(asked[0], /^Delete the version of “Product v2\.3” from 7 Nov 2026/);
        assert.equal(server.posts[1].url, '/queue/sessions/2026-10-12T14-03-27/items/i1/versions/delete');
    });

    test('deleting a row with versions says they go too', async () => {
        const asked = [];
        const {p} = panel([finished([baseItem({versions: [later]}), baseItem({id: 'i2', name: 'Second'})])], {
            confirmDelete: (msg) => { asked.push(msg); return false; },
        });
        await p.refresh();
        document.querySelector('tr[data-item-id="i1"] [title="Delete"]').click();
        assert.match(asked[0], /^Delete “Product v2\.3” and its 2 versions from /);
    });

    test('a finished row runs again, its result to wait beside the active one', async () => {
        const {p, server} = panel([finished([baseItem()])]);
        await p.refresh();
        const again = button('Run again');
        assert.equal(again.querySelector('.visually-hidden').textContent, 'Run again Product v2.3');
        again.click();
        await until(() => server.posts.length, 'the re-run');
        assert.equal(server.posts[0].url, '/queue/sessions/2026-10-12T14-03-27/items/i1/rerun');
        await until(() => /Running “Product v2\.3” again/.test(status()), 'what it says');
    });

    test('no Run again for a report added as it was, or while a run goes', async () => {
        const {p} = panel([{concurrency: 1, maxConcurrency: 8, sessions: [
            session({id: 'running', state: 'running'}, [baseItem({id: 'r', status: 'running'})]),
            session({id: 'done'}, [baseItem({id: 'imp', imported: {at: 'x'}, hasConfig: false}), baseItem({id: 'ok'})]),
        ]}]);
        await p.refresh();
        const done = document.querySelector('[data-session-id="done"]');
        assert.match(done.querySelector('tr[data-item-id="imp"]').textContent, /Added as a report/);
        assert.equal(done.querySelector('tr[data-item-id="imp"] [title="Run again"]'), null);
        // Another batch runs: said when pressed, not done.
        const held = done.querySelector('tr[data-item-id="ok"] [title="Run again"]');
        assert.equal(held.getAttribute('aria-disabled'), 'true');
        held.click();
        assert.match(status(), /Another batch is running/);
    });

    test('a finished row is deleted from its batch once confirmed, focus going to the next', async () => {
        const asked = [];
        const answers = [false, true];
        const {p, server} = panel([finished([baseItem(), baseItem({id: 'i2', name: 'Second'})])], {
            confirmDelete: (msg) => { asked.push(msg); return answers.shift(); },
        });
        await p.refresh();
        const del = document.querySelector('tr[data-item-id="i1"] [title="Delete"]');
        assert.equal(del.querySelector('.visually-hidden').textContent, 'Delete Product v2.3');
        del.click();
        assert.equal(server.posts.length, 0, 'not deleted when not confirmed');
        assert.match(asked[0], /^Delete “Product v2\.3” from .*\? Its result, and the pictures and evidence only it used, are removed from the server\. This cannot be undone\.$/);
        document.querySelector('tr[data-item-id="i1"] [title="Delete"]').click();
        await until(() => server.posts.length, 'the delete');
        assert.equal(server.posts[0].url, '/queue/sessions/2026-10-12T14-03-27/items/i1/delete');
        await until(() => /Deleted “Product v2\.3” from /.test(status()), 'what it says');
        assert.equal(document.activeElement.getAttribute('data-focus-key'), 'delete-item:i2');
    });

    test('no Delete while a run goes; held while another batch runs, and on a batch\'s only run', async () => {
        const {p} = panel([{concurrency: 1, maxConcurrency: 8, sessions: [
            session({id: 'running', state: 'running'}, [baseItem({id: 'r', status: 'running'}), baseItem({id: 'w', status: 'waiting'})]),
            session({id: 'done'}, [baseItem({id: 'ok'}), baseItem({id: 'ok2'})]),
            session({id: 'one', counts: {total: 1, done: 1}}, [baseItem({id: 'only'})]),
        ]}]);
        await p.refresh();
        assert.equal(document.querySelector('[data-session-id="running"] [title="Delete"]'), null);
        const held = document.querySelector('tr[data-item-id="ok"] [title="Delete"]');
        assert.equal(held.getAttribute('aria-disabled'), 'true');
        held.click();
        assert.match(status(), /Another batch is running/);
        const only = document.querySelector('tr[data-item-id="only"] [title="Delete"]');
        assert.equal(only.getAttribute('aria-disabled'), 'true');
    });

    test('a batch\'s only run says to delete the batch instead', async () => {
        const {p, server} = panel([finished([baseItem()])]);
        await p.refresh();
        const only = document.querySelector('tr[data-item-id="i1"] [title="Delete"]');
        assert.equal(only.getAttribute('aria-disabled'), 'true');
        only.click();
        assert.equal(status(), 'This is the batch’s only run. Delete the batch instead.');
        assert.equal(server.posts.length, 0);
    });

    test('a run with passwords asks for them before it runs again, even with them typed in the editor', async () => {
        const fields = [{key: 'k1', action: 'Set password value', field: 'Password', target: '#pass', where: 'Step 2', rows: 1,
            match: {path: ['actions', 1], field: 'value', step: {type: 'setPassword', selector: '#pass', valueMasked: true}}}];
        const asked = [];
        const answers = [null, {k1: 'typed'}];
        const {p, server} = panel([finished([baseItem({needsValues: true})])], {
            maskedFields: fields,
            askMaskedValues: async (f) => { asked.push(f); return answers.shift(); },
            getFormWorkflow: () => ({actions: [{type: 'goto'}, {type: 'setPassword', selector: '#pass', value: 'hunter2', valueMasked: true}]}),
        });
        await p.refresh();
        button('Run again').click();
        await until(() => status() === 'Not run again.', 'the prompt dismissed');
        assert.equal(server.posts.length, 0, 'dismissed: nothing runs');
        assert.equal(asked[0][0].value, 'hunter2', 'filled in from the editor');
        button('Run again').click();
        await until(() => server.posts.length, 'the re-run');
        assert.deepEqual(server.posts[0].body, {values: {k1: 'typed'}});
    });

    test('a row says when a re-run ended with nothing to choose; not otherwise', () => {
        assert.equal(mod.describeReruns(baseItem({reruns: 1, lastRerun: {at: '2026-11-07T09:15:00.000Z', status: 'error', error: 'Site down'}})),
            `Run again ${mod.formatWhen('2026-11-07T09:15:00.000Z')} failed (Site down), so this is the earlier result`);
        assert.equal(mod.describeReruns(baseItem({reruns: 2, lastRerun: {status: 'done', kept: 'new'}})), null);
        assert.equal(mod.describeReruns(baseItem({reruns: 1, lastRerun: {status: 'error', kept: 'active'}})), null, 'chosen: nothing to say');
        assert.equal(mod.describeReruns(baseItem({reruns: 1, lastRerun: {status: 'done', kept: 'pending'}, candidate: {file: 'x'}})), null);
        assert.equal(mod.describeReruns(baseItem()), null);
    });

    test('every status says when it was reached, in full, and "Ran again" under it when the result came from a re-run', async () => {
        const {p} = panel([finished([
            baseItem({id: 'a', finishedAt: '2026-11-06T11:33:37.000Z'}),
            baseItem({id: 'b', finishedAt: '2026-11-07T09:15:02.000Z', ranAgain: true}),
            baseItem({id: 'c', status: 'error', error: 'Site down', finishedAt: '2026-11-06T11:34:02.000Z'}),
        ])]);
        await p.refresh();
        const when = (id) => document.querySelector(`tr[data-item-id="${id}"] .queue-status time`);
        assert.equal(when('a').textContent, mod.formatWhen('2026-11-06T11:33:37.000Z'));
        assert.match(when('a').textContent, /^6 Nov 2026, \d\d:\d\d$/);
        assert.equal(when('a').getAttribute('datetime'), '2026-11-06T11:33:37.000Z');
        assert.match(when('a').title, /^Finished 6 November 2026(,| at) \d\d:\d\d:37$/);
        const notes = (id) => [...document.querySelectorAll(`tr[data-item-id="${id}"] .queue-status .queue-note`)].map((n) => n.textContent);
        assert.deepEqual(notes('a').slice(1), []);
        assert.deepEqual(notes('b').slice(1), ['Ran again'], 'under the date');
        assert.match(when('c').title, /^Ended /);
        assert.deepEqual(notes('c').slice(1), ['Site down']);
    });

    test('a finished batch offers no runs to add to it', async () => {
        const {p} = panel([finished([baseItem()])]);
        await p.refresh();
        assert.equal(button('Add the open workflow'), undefined);
        assert.equal(button('Add a report'), undefined);
        assert.ok(button('Run again'));
    });
});
