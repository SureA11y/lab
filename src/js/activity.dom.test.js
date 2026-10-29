'use strict';

// The activity panel (src/js/activity.js): actions with steps, shown top right.

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let A;

before(async () => {
    A = await import('./activity.js');
});

// Timers the test moves by hand.
function fakeClock() {
    let t = 0;
    let seq = 0;
    const pending = new Map();
    return {
        now: () => t,
        setTimer: (fn, ms) => { const id = ++seq; pending.set(id, {at: t + ms, fn}); return id; },
        clearTimer: (id) => { pending.delete(id); },
        tick(ms) {
            const end = t + ms;
            for (;;) {
                const due = [...pending.entries()].filter(([, p]) => p.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) break;
                pending.delete(due[0]);
                t = due[1].at;
                due[1].fn();
            }
            t = end;
        },
    };
}

let doc;
let clock;
let center;

beforeEach(() => {
    const dom = new JSDOM('<!doctype html><html><body><header></header><button id="outside">Outside</button></body></html>', {pretendToBeVisual: true});
    globalThis.window = dom.window;
    doc = dom.window.document;
    clock = fakeClock();
    center = A.createActivityCenter({doc, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, showAfterMs: 400, keepMs: 5000});
});

const cards = () => [...doc.querySelectorAll('.activity-card')];
const said = () => [...doc.querySelectorAll('[role=status], [role=alert]')].map((r) => r.textContent).join(' | ');

describe('the activity panel', () => {
    test('a quick action never shows a card, but its end is said', () => {
        const task = center.start('Load configuration');
        clock.tick(200);
        task.done('Configuration loaded.');
        clock.tick(100);
        assert.equal(cards().length, 0);
        assert.match(said(), /Load configuration: Configuration loaded\./);
        assert.equal(center.list()[0].state, 'done', 'the Activity list keeps it');
    });

    test('a longer one shows once it has taken a moment, its steps as they come', () => {
        const task = center.start('Download report "Checkout"');
        task.step('Copying the report');
        clock.tick(450);
        assert.equal(cards().length, 1);
        assert.equal(doc.querySelector('.activity-panel').hidden, false);
        assert.match(said(), /Download report "Checkout": started\./);

        const packing = task.step('Packing the pictures');
        packing.update('120 of 340');
        const steps = [...doc.querySelectorAll('.activity-step')];
        assert.equal(steps.length, 2);
        assert.match(steps[0].className, /activity-step--done/, 'a new step ends the one before');
        assert.match(steps[0].textContent, /Done: Copying the report/);
        assert.match(steps[1].className, /activity-step--running/);
        assert.match(steps[1].textContent, /In progress: Packing the pictures120 of 340/);
        assert.doesNotMatch(said(), /Packing/, 'steps are not announced');
    });

    test('a card that ends well goes after a few seconds; not while hovered or in focus', () => {
        const task = center.start('Download report');
        clock.tick(450);
        task.done('Saved Checkout.zip');
        assert.equal(doc.querySelector('.activity-card__result').textContent, 'Saved Checkout.zip');
        doc.querySelector('.activity-panel').dispatchEvent(new window.Event('mouseenter'));
        clock.tick(10000);
        assert.equal(cards().length, 1, 'kept while the pointer is over it');
        doc.querySelector('.activity-panel').dispatchEvent(new window.Event('mouseleave'));
        clock.tick(4900);
        assert.equal(cards().length, 1);
        clock.tick(200);
        assert.equal(cards().length, 0);
        assert.equal(doc.querySelector('.activity-panel').hidden, true);
    });

    test('a warning or a failure stays until closed, and a failure is said at once', () => {
        const warned = center.start('Download report');
        const step = warned.step('Packing the pictures');
        step.warn('3 pictures could not be added');
        warned.done('Saved Checkout.zip');
        assert.equal(cards().length, 1, 'shown even though it was quick');
        assert.match(cards()[0].className, /activity-card--warning/);

        const failed = center.start('Download comparison');
        failed.fail(new Error('Out of memory'));
        clock.tick(60000);
        assert.equal(cards().length, 2);
        assert.match(doc.querySelector('[role=alert]').textContent, /Download comparison: Out of memory/);

        const close = cards()[0].querySelector('.activity-card__close');
        assert.equal(close.getAttribute('aria-label'), 'Close: Download comparison');
        close.focus();
        close.click();
        assert.equal(cards().length, 1);
        assert.equal(doc.activeElement, cards()[0].querySelector('.activity-card__toggle'), 'focus goes to the next card');
    });

    test('a running card can be hidden: it goes on, and a second press shows it again', () => {
        const task = center.start('Download report');
        clock.tick(450);
        const close = cards()[0].querySelector('.activity-card__close');
        assert.equal(close.getAttribute('aria-label'), 'Hide: Download report');
        close.click();
        assert.equal(cards().length, 0);
        task.step('Compressing');
        assert.equal(cards().length, 0);
        task.reveal();
        assert.equal(cards().length, 1);
        assert.match(cards()[0].className, /is-flashing/);
        clock.tick(100);
        assert.match(said(), /Download report: still in progress\./);
    });

    test('Cancel aborts the work, which ends cancelled', async () => {
        let seen = null;
        const done = center.run('Download report', async (task) => {
            task.step('Packing');
            await new Promise((resolve) => task.signal.addEventListener('abort', resolve));
            seen = task.signal.aborted;
            task.throwIfCancelled();
        }, {cancellable: true});
        clock.tick(450);
        const cancel = doc.querySelector('.activity-card__cancel');
        assert.ok(cancel);
        cancel.click();
        await done;
        assert.equal(seen, true);
        assert.equal(center.list()[0].state, 'cancelled');
        assert.equal(center.list()[0].steps[0].state, 'cancelled');
        assert.equal(doc.querySelector('.activity-card__cancel'), null);
    });

    test('run() ends the task with what the work gives, or fails with what it throws', async () => {
        const value = await center.run('Open report', async () => 3, {result: (n) => `${n} reports loaded.`});
        assert.equal(value, 3);
        assert.equal(center.list()[0].result, '3 reports loaded.');
        await assert.rejects(center.run('Open report', async () => { throw new Error('Not a zip'); }), /Not a zip/);
        assert.equal(center.list()[1].state, 'failed');
        assert.equal(center.list()[1].result, 'Not a zip');
    });

    test('a question shows the card at once and takes focus, and gives it back', async () => {
        const outside = doc.getElementById('outside');
        outside.focus();
        const task = center.start('Download as a single file');
        task.step('Building the report');
        const answer = task.ask('This file is 72 MB.', [{label: 'Download it', value: 'go'}, {label: 'Get the zip instead', value: 'zip'}]);
        assert.equal(cards().length, 1);
        assert.match(cards()[0].className, /activity-card--waiting/);
        const choices = [...doc.querySelectorAll('.activity-card__choice')];
        assert.deepEqual(choices.map((b) => b.textContent), ['Download it', 'Get the zip instead']);
        assert.equal(doc.activeElement, choices[0]);
        clock.tick(100);
        assert.match(doc.querySelector('[role=alert]').textContent, /72 MB/);
        choices[1].click();
        assert.equal(await answer, 'zip');
        assert.equal(doc.activeElement, outside);
        assert.equal(doc.querySelector('.activity-card__choice'), null);
    });

    test('older cards fold to their title line, newest three open', () => {
        for (let i = 1; i <= 4; i += 1) center.start(`Action ${i}`);
        clock.tick(450);
        const toggles = [...doc.querySelectorAll('.activity-card__toggle')];
        assert.deepEqual(toggles.map((t) => t.textContent), ['Action 4', 'Action 3', 'Action 2', 'Action 1']);
        assert.deepEqual(toggles.map((t) => t.getAttribute('aria-expanded')), ['true', 'true', 'true', 'false']);
        toggles[3].click();
        assert.equal(doc.querySelectorAll('.activity-card__toggle')[3].getAttribute('aria-expanded'), 'true');
    });

    test('the Activity button counts what is in progress and opens the panel with this page\'s actions', () => {
        const button = center.installButton(doc.querySelector('header'));
        assert.equal(button.getAttribute('aria-label'), 'Activity');
        const task = center.start('Download report');
        task.step('Compressing', '40%');
        assert.equal(button.getAttribute('aria-label'), 'Activity, 1 in progress');
        task.done('Saved Checkout.zip');
        assert.equal(button.getAttribute('aria-label'), 'Activity');

        // The finished one has gone: the button brings it back, with every
        // other action of the page, in the panel itself.
        clock.tick(10000);
        assert.equal(cards().length, 0);
        const quick = center.start('Load configuration');
        quick.done('Configuration loaded.');
        button.click();
        const panel = doc.querySelector('.activity-panel');
        assert.equal(button.getAttribute('aria-expanded'), 'true');
        assert.equal(button.getAttribute('aria-controls'), panel.id);
        assert.equal(panel.hidden, false);
        assert.equal(doc.querySelector('dialog'), null, 'not a dialog');
        assert.equal(doc.activeElement, doc.querySelector('.activity-panel__title'));
        assert.deepEqual(cards().map((c) => c.querySelector('.activity-card__title').textContent), ['Load configuration', 'Download report'], 'newest first');
        assert.match(cards()[1].textContent, /Compressing/);
        assert.match(cards()[1].textContent, /Saved Checkout\.zip/);
        assert.match(cards()[1].querySelector('.activity-card__time').textContent, /^\d\d:\d\d:\d\d · /, 'with when it started');
        assert.equal(cards()[0].querySelector('.activity-card__close').getAttribute('aria-label'), 'Remove from the list: Load configuration');
        clock.tick(60000);
        assert.equal(cards().length, 2, 'none leaves while it is open');

        // Escape closes it, back to the button, and the finished ones go again.
        doc.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
        assert.equal(button.getAttribute('aria-expanded'), 'false');
        assert.equal(doc.activeElement, button);
        assert.equal(cards().length, 0);
        assert.equal(panel.hidden, true);

        // A press elsewhere closes it too; a card that was showing stays.
        const running = center.start('Download comparison');
        clock.tick(450);
        button.click();
        assert.equal(cards().length, 3);
        doc.getElementById('outside').dispatchEvent(new window.Event('pointerdown', {bubbles: true}));
        assert.equal(button.getAttribute('aria-expanded'), 'false');
        assert.deepEqual(cards().map((c) => c.querySelector('.activity-card__title').textContent), ['Download comparison']);
        running.done('Downloaded comparison.html');
    });
});

describe('the Activity list', () => {
    test('a finished action is one line until opened; a running one shows its steps', () => {
        const button = center.installButton(doc.querySelector('header'));
        const old = center.start('Download comparison');
        old.step('Building the comparison');
        old.done('Downloaded comparison.html');
        const running = center.start('Download comparison with the reports');
        running.step('Compressing', '30%');
        button.click();

        const [now, done] = cards();
        assert.equal(now.classList.contains('is-collapsed'), false);
        assert.equal(now.querySelector('.activity-card__body').hidden, false);
        assert.equal(now.querySelector('.activity-card__close').hidden, true, 'a running action is not removed from the list');
        assert.equal(done.classList.contains('is-collapsed'), true);
        assert.equal(done.querySelector('.activity-card__body').hidden, true);
        const toggle = done.querySelector('.activity-card__toggle');
        assert.equal(toggle.getAttribute('aria-expanded'), 'false');
        assert.equal(toggle.title, 'Download comparison', 'its title whole, where the line cuts it short');
        assert.match(done.querySelector('.activity-card__state').className, /sr-only/, 'the icon says Done; a screen reader hears it');

        toggle.click();
        assert.equal(toggle.getAttribute('aria-expanded'), 'true');
        assert.equal(done.querySelector('.activity-card__body').hidden, false);
        assert.match(done.textContent, /Building the comparison/);

        // Opened again later, it starts folded again.
        button.click();
        button.click();
        assert.equal(cards()[1].classList.contains('is-collapsed'), true);
        running.done('Downloaded');
    });

    test('a finished action can be removed from the list, for good', () => {
        const button = center.installButton(doc.querySelector('header'));
        const a = center.start('Load configuration');
        a.done('Configuration loaded.');
        const b = center.start('Open "v22.0.0" from the queue');
        b.done('Opened.');
        button.click();
        assert.equal(cards().length, 2);

        const close = cards()[0].querySelector('.activity-card__close');
        assert.equal(close.hidden, false);
        assert.equal(close.getAttribute('aria-label'), 'Remove from the list: Open "v22.0.0" from the queue');
        close.focus();
        close.click();
        assert.deepEqual(cards().map((c) => c.querySelector('.activity-card__title').textContent), ['Load configuration']);
        assert.equal(doc.activeElement, cards()[0].querySelector('.activity-card__toggle'), 'focus to the next one');
        clock.tick(100);
        assert.match(said(), /Removed from the list: Open "v22\.0\.0" from the queue/);

        // Closed and opened again, it does not come back.
        button.click();
        button.click();
        assert.deepEqual(cards().map((c) => c.querySelector('.activity-card__title').textContent), ['Load configuration']);

        // The last one gone, the list says it is empty, and focus is on its title.
        cards()[0].querySelector('.activity-card__close').click();
        assert.equal(cards().length, 0);
        assert.equal(doc.querySelector('.activity-panel__empty').hidden, false);
        assert.equal(doc.activeElement, doc.querySelector('.activity-panel__title'));
    });
});

describe('formatDuration', () => {
    test('reads as a short time', () => {
        assert.equal(A.formatDuration(40), '0.1s');
        assert.equal(A.formatDuration(820), '0.8s');
        assert.equal(A.formatDuration(12_400), '12s');
        assert.equal(A.formatDuration(65_000), '1m 05s');
    });
});

describe('a quiet task', () => {
    test('shows its card but leaves the start and the end to its page\'s status line', () => {
        const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
        const d = dom.window.document;
        const c = fakeClock();
        const quietCenter = A.createActivityCenter({doc: d, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer});
        const task = quietCenter.start('Compare: load 3 files', {quiet: true});
        c.tick(450);
        task.fail('Not a zip');
        c.tick(100);
        assert.equal(d.querySelectorAll('.activity-card').length, 1);
        assert.equal([...d.querySelectorAll('[role=status], [role=alert]')].map((r) => r.textContent).join(''), '');
    });
});
