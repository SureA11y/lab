'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { automaticConcurrency, createRunQueue, describeMaskedSlot, findMaskedSlots, hasMaskedValues, summarizePayload } = require('./run-queue');
const files = require('./queue-files');

/* ---------- helpers ---------- */

let baseDir;

beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-queue-'));
});

afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
});

/** An executeRun whose calls stay pending until the test settles them. */
function controlledRunner() {
    const calls = [];
    const executeRun = (spec, hooks) => new Promise((resolve) => {
        calls.push({ spec, hooks, resolve });
    });
    return { calls, executeRun };
}

/**
 * A payload as a workflow run builds it: each scan with its findings by
 * outcome in its summary, and payload.findings merged across scans by rule,
 * so a rule that fails on every scan is listed there once.
 */
function payloadWith({ scans = [{}], extra = {} } = {}) {
    return {
        scans: scans.map((c, i) => ({
            scanId: `s${i}`,
            summary: { failCount: c.fail || 0, reviewCount: c.cantTell || 0, passesCount: c.pass || 0 },
        })),
        findings: { fail: [{ ruleId: 'image-alt' }], cantTell: [], pass: [] },
        ...extra,
    };
}

function item(name, { url = 'https://example.com/', config = null } = {}) {
    return {
        run: { url, scenarioName: name, actions: [{ type: 'a11yScan', profile: 'en301549-v4.1.1' }] },
        config,
    };
}

const tick = () => new Promise((r) => setImmediate(r));

function finishedCount(queue) {
    return queue.getState().sessions.reduce((n, s) => n + s.items.filter((i) => i.finishedAt).length, 0);
}

async function waitUntil(check, what) {
    const deadline = Date.now() + 2000;
    while (!check()) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 2));
    }
}

/** Ends a pending run and waits until the queue has saved and recorded it. */
async function settle(queue, call, result) {
    const before = finishedCount(queue);
    call.resolve(result);
    await waitUntil(() => finishedCount(queue) > before, 'the item to finish');
}

function onlySession(queue) {
    return queue.getState().sessions[0];
}

// Most tests follow one run at a time, so set it; `automatic: true` leaves
// the queue's own number of runs at once.
function newQueue(executeRun, { automatic = false, ...opts } = {}) {
    const queue = createRunQueue({ baseDir, executeRun, logError: () => {}, ...opts });
    queue.init();
    if (!automatic) queue.setConcurrency(1);
    return queue;
}

/* ---------- tests ---------- */

describe('run queue', () => {
    test('by default a batch runs as many at once as it has runs, up to 8', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun, { automatic: true });
        assert.equal(queue.getState().concurrencyChosen, false);
        queue.addItems([item('A'), item('B'), item('C')]);
        assert.equal(runner.calls.length, 3);
        assert.equal(queue.getState().concurrency, 3);
        for (const call of runner.calls) await settle(queue, call, { status: 'done', payload: payloadWith() });

        queue.addItems(Array.from({ length: 12 }, (_, i) => item(`R${i}`)));
        assert.equal(runner.calls.length - 3, 8);
        assert.equal(queue.getState().concurrency, 8);
        assert.equal(queue.getState().sessions[0].items.filter((i) => i.status === 'waiting').length, 4);
    });

    test('a setting someone chose holds for every later batch', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun, { automatic: true });
        queue.setConcurrency(2);
        queue.addItems([item('A'), item('B'), item('C'), item('D')]);
        assert.equal(runner.calls.length, 2);
        assert.equal(queue.getState().concurrency, 2);
        assert.equal(queue.getState().concurrencyChosen, true);
    });

    test('"auto" goes back to the batch\'s own number of runs', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.addItems([item('A'), item('B'), item('C')]);
        assert.equal(runner.calls.length, 1);
        assert.equal(queue.setConcurrency('auto'), 3);
        assert.equal(runner.calls.length, 3);
        assert.equal(queue.getState().concurrencyChosen, false);
    });

    test('automaticConcurrency: the number of runs, from 1 to the maximum', () => {
        assert.equal(automaticConcurrency(1), 1);
        assert.equal(automaticConcurrency(5), 5);
        assert.equal(automaticConcurrency(8), 8);
        assert.equal(automaticConcurrency(30), 8);
        assert.equal(automaticConcurrency(30, 4), 4);
        assert.equal(automaticConcurrency(0), 1);
    });

    test('runs one item at a time when set to, in the order added', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.addItems([item('A'), item('B')]);

        assert.equal(runner.calls.length, 1);
        assert.equal(runner.calls[0].spec.scenarioName, 'A');
        assert.deepEqual(onlySession(queue).items.map((i) => i.status), ['running', 'waiting']);

        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        assert.equal(runner.calls.length, 2);
        assert.equal(runner.calls[1].spec.scenarioName, 'B');
    });

    test('passes only the fields the runner reads', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.addItems([{ run: { ...item('A').run, groupScans: true, stray: 1 } }]);
        assert.deepEqual(Object.keys(runner.calls[0].spec).sort(), ['actions', 'scenarioName', 'url']);
    });

    test('passes how the page is shown as the run starts', () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.addItems([{ run: { ...item('A').run, colorScheme: 'dark', highContrast: 'on', language: '{var:lang}' } }]);
        const { colorScheme, highContrast, language } = runner.calls[0].spec;
        assert.deepEqual({ colorScheme, highContrast, language }, { colorScheme: 'dark', highContrast: 'on', language: '{var:lang}' });
    });

    test('a run kept with its own Include and Exclude selectors runs with them on its scans', () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.addItems([{ run: { ...item('A').run, context: 'main', exclude: '.ads' } }]);
        const { spec } = runner.calls[0];
        assert.ok(!('context' in spec) && !('exclude' in spec));
        assert.deepEqual(spec.actions, [{ type: 'a11yScan', profile: 'en301549-v4.1.1', context: 'main', exclude: '.ads' }]);
    });

    test('runs up to the concurrency setting at once, and a raised setting starts more straight away', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.setConcurrency(2);
        queue.addItems([item('A'), item('B'), item('C'), item('D')]);
        assert.equal(runner.calls.length, 2);

        queue.setConcurrency(4);
        assert.equal(runner.calls.length, 4);
    });

    test('lowering the concurrency stops no running run; new rows start only once fewer are running', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.setConcurrency(4);
        queue.addItems([item('A'), item('B'), item('C'), item('D'), item('E'), item('F')]);
        assert.equal(runner.calls.length, 4);

        queue.setConcurrency(2);
        const statuses = () => onlySession(queue).items.map((i) => i.status);
        assert.deepEqual(statuses(), ['running', 'running', 'running', 'running', 'waiting', 'waiting'], 'nothing paused or cancelled');
        assert.equal(runner.calls.every((c) => !c.hooks.isCancelled() && !c.hooks.abortSignal.aborted), true);

        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        assert.equal(runner.calls.length, 4, '3 still running, more than 2: nothing new starts');
        await settle(queue, runner.calls[1], { status: 'done', payload: payloadWith() });
        assert.equal(runner.calls.length, 4, '2 still running, not fewer than 2: nothing new starts');
        await settle(queue, runner.calls[2], { status: 'done', payload: payloadWith() });
        assert.equal(runner.calls.length, 5, 'down to 1 running: the next row starts');
        assert.deepEqual(statuses(), ['done', 'done', 'done', 'running', 'running', 'waiting']);
    });

    test('refuses a concurrency outside 1 to 8', () => {
        const queue = newQueue(controlledRunner().executeRun);
        for (const bad of [0, 9, 1.5, 'two', null]) {
            assert.throws(() => queue.setConcurrency(bad), (err) => err.statusCode === 400);
        }
        assert.equal(queue.setConcurrency('3'), 3);
        assert.equal(queue.setConcurrency(8), 8);
    });

    test('keeps the batch\'s scenario name in batch.json, through a restart and a resume', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const { sessionId } = queue.addItems(
            [item('A', { config: { runSpec: item('A').run } }), item('B', { config: { runSpec: item('B').run } })],
            { name: '  Web Banking  ' },
        );
        assert.equal(onlySession(queue).name, 'Web Banking');
        assert.equal(files.readManifest(path.join(baseDir, sessionId)).name, 'Web Banking');
        assert.equal(runner.calls[0].spec.scenarioName, 'A', 'each row still runs under its own name');
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });

        const next = controlledRunner();
        const restarted = newQueue(next.executeRun);
        assert.equal(onlySession(restarted).name, 'Web Banking');
        restarted.resumeSession(sessionId);
        assert.equal(onlySession(restarted).name, 'Web Banking', 'resumed under the same name');
        await settle(restarted, next.calls[0], { status: 'done', payload: payloadWith() });
        assert.equal(files.readManifest(path.join(baseDir, sessionId)).name, 'Web Banking');
    });

    test('a batch without a scenario name, or saved before batches had one, has none', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const { sessionId } = queue.addItems([item('A')], { name: '   ' });
        assert.equal(onlySession(queue).name, null);
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });

        const dir = path.join(baseDir, sessionId);
        const { name, ...older } = files.readManifest(dir);
        files.writeManifest(dir, older);
        assert.equal(newQueue(runner.executeRun).getState().sessions[0].name, null);
    });

    test('saves each finished run as its own file and records its summary', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const { sessionId } = queue.addItems([item('Product v2.3')]);

        runner.calls[0].hooks.progress({ type: 'scan', message: 'a11yScan ready' });
        runner.calls[0].hooks.progress({ type: 'scan', message: 'a11yScan skipped' });
        runner.calls[0].hooks.progress({ type: 'info', message: 'browsing' });
        assert.equal(onlySession(queue).items[0].scans, 1, 'live scan count while running');

        const scans = [{ fail: 2, cantTell: 1, pass: 3 }, { fail: 1, pass: 2 }];
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith({ scans }) });

        const session = onlySession(queue);
        assert.equal(session.id, sessionId);
        assert.equal(session.state, 'finished');
        const [done] = session.items;
        assert.equal(done.status, 'done');
        assert.equal(done.file, 'Product-v2.3.json');
        assert.equal(done.scans, 2);
        assert.deepEqual(done.findings, { fail: 3, cantTell: 1, pass: 5 }, 'each scan counted, not the merged findings');
        assert.ok(Number.isFinite(done.durationMs));

        const saved = JSON.parse(fs.readFileSync(path.join(baseDir, sessionId, 'Product-v2.3.json'), 'utf8'));
        assert.equal(saved.scans.length, 2);

        const manifest = files.readManifest(path.join(baseDir, sessionId));
        assert.equal(manifest.items[0].status, 'done');
        assert.ok(manifest.finishedAt, 'session closed once idle');
        assert.deepEqual(fs.readdirSync(path.join(baseDir, sessionId)).sort(), ['Product-v2.3.json', 'batch.json']);
    });

    test('adds up each scan\'s findings while a run goes, then shows the saved figures', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.addItems([item('A')]);
        const { progress } = runner.calls[0].hooks;
        assert.deepEqual(onlySession(queue).items[0].findings, { fail: 0, cantTell: 0, pass: 0, soFar: true });

        progress({ type: 'scan', message: 'a11yScan ready', extra: { summary: { failCount: 2, reviewCount: 1, passesCount: 3 } } });
        progress({ type: 'scan', message: 'a11yScan ready', extra: { summary: { failCount: 1, reviewCount: 0, passesCount: 4 } } });
        progress({ type: 'scan', message: 'a11yScan skipped', extra: { summary: { failCount: 99 } } });
        assert.deepEqual(onlySession(queue).items[0].findings, { fail: 3, cantTell: 1, pass: 7, soFar: true });

        const scans = [{ fail: 2, cantTell: 1, pass: 3 }, { fail: 1, pass: 4 }];
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith({ scans }) });
        assert.deepEqual(onlySession(queue).items[0].findings, { fail: 3, cantTell: 1, pass: 7 }, 'the saved figures match the live ones');
    });

    test('from an older runner, with no key: a merged scan swaps its scans for itself in the live counts', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.addItems([item('A')]);
        const { progress } = runner.calls[0].hooks;
        progress({ type: 'scan', message: 'a11yScan ready', extra: { summary: { failCount: 1, reviewCount: 0, passesCount: 3 } } });
        progress({ type: 'scan', message: 'a11yScan ready', extra: { summary: { failCount: 2, reviewCount: 1, passesCount: 3 } } });
        progress({ type: 'scan', message: 'a11yScan ready', extra: { summary: { failCount: 2, reviewCount: 1, passesCount: 3 } } });
        progress({ type: 'scan', message: 'a11yScan merged', extra: {
            summary: { failCount: 2, reviewCount: 1, passesCount: 4 },
            contexts: [
                { summary: { failCount: 2, reviewCount: 1, passesCount: 3 } },
                { summary: { failCount: 2, reviewCount: 1, passesCount: 3 } },
            ],
        } });
        const live = onlySession(queue).items[0];
        assert.deepEqual(live.findings, { fail: 3, cantTell: 1, pass: 7, soFar: true }, 'one scan of its own, one merged');
        assert.equal(live.scans, 2);
    });

    test('a Merged scan counts once from its first context; the scans run are counted beside, live and saved', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.addItems([item('A')]);
        const { progress } = runner.calls[0].hooks;
        const ready = (key) => progress({ type: 'scan', message: 'a11yScan ready', extra: { mergedScanKey: key, summary: { failCount: 1, reviewCount: 0, passesCount: 1 } } });
        ready(null);
        ready('merged-1');
        ready('merged-1');
        let live = onlySession(queue).items[0];
        assert.deepEqual([live.scans, live.scansRun], [2, 3]);
        progress({ type: 'scan', message: 'a11yScan merged', extra: {
            key: 'merged-1',
            summary: { failCount: 1, reviewCount: 0, passesCount: 1 },
            contexts: [{ summary: { failCount: 1, reviewCount: 0, passesCount: 1 } }, { summary: { failCount: 1, reviewCount: 0, passesCount: 1 } }],
        } });
        live = onlySession(queue).items[0];
        assert.deepEqual([live.scans, live.scansRun], [2, 3], 'the fold changes neither');

        const scans = [{ fail: 1, pass: 1 }, { fail: 1, pass: 1 }];
        const payload = payloadWith({ scans });
        payload.scans[1].mergedScan = true;
        payload.scans[1].contexts = [{ name: 'Light' }, { name: 'Dark' }, { name: 'Off', skipped: true }];
        await settle(queue, runner.calls[0], { status: 'done', payload });
        const done = onlySession(queue).items[0];
        assert.deepEqual([done.scans, done.scansRun], [2, 3], 'from the saved result: skipped contexts did not run');
    });

    test('gives runs with the same name distinct files, and never overwrites the manifest', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.setConcurrency(3);
        queue.addItems([item('v1'), item('v1'), item('batch')]);
        for (const call of runner.calls) await settle(queue, call, { status: 'done', payload: payloadWith() });
        assert.deepEqual(onlySession(queue).items.map((i) => i.file), ['v1.json', 'v1-2.json', 'batch-2.json']);
    });

    test('keeps a run named after a path inside the session folder', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const { sessionId } = queue.addItems([item('../../etc/passwd')]);
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        const file = onlySession(queue).items[0].file;
        assert.equal(file, 'etc-passwd.json');
        assert.ok(fs.existsSync(path.join(baseDir, sessionId, file)));
    });

    test('a failed run with a partial result is saved and marked failed; one without is recorded only', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.setConcurrency(2);
        queue.addItems([item('partial'), item('nothing')]);
        await settle(queue, runner.calls[0], { status: 'error', payload: payloadWith({ extra: { errorDetails: { message: 'Timeout on step 3' } } }) });
        await settle(queue, runner.calls[1], { status: 'error', payload: null, error: { details: 'Browser crashed' } });

        const [partial, nothing] = onlySession(queue).items;
        assert.equal(partial.status, 'error');
        assert.equal(partial.file, 'partial.json');
        assert.equal(partial.error, 'Timeout on step 3');
        assert.equal(nothing.status, 'error');
        assert.equal(nothing.file, null);
        assert.equal(nothing.error, 'Browser crashed');
    });

    test('a runner that throws fails the item and the queue carries on', async () => {
        let n = 0;
        const runner = controlledRunner();
        const executeRun = (spec, hooks) => {
            n += 1;
            if (n === 1) return Promise.reject(new Error('boom'));
            return runner.executeRun(spec, hooks);
        };
        const queue = newQueue(executeRun);
        queue.addItems([item('A'), item('B')]);
        for (let i = 0; i < 10; i += 1) await tick();
        const [a, b] = onlySession(queue).items;
        assert.equal(a.status, 'error');
        assert.equal(a.error, 'boom');
        assert.equal(b.status, 'running');
    });

    test('cancels a waiting item without running it, and a running one through its abort signal', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.addItems([item('A'), item('B'), item('C')]);
        const [a, b] = onlySession(queue).items;

        assert.equal(queue.cancelItem(b.id), 'cancelled');
        assert.equal(queue.cancelItem(a.id), 'cancelling');
        assert.equal(runner.calls[0].hooks.isCancelled(), true);
        assert.equal(runner.calls[0].hooks.abortSignal.aborted, true);

        await settle(queue, runner.calls[0], { status: 'cancelled', payload: payloadWith() });
        const items = onlySession(queue).items;
        assert.deepEqual(items.map((i) => i.status), ['cancelled', 'cancelled', 'running']);
        assert.equal(items[0].file, 'A.json', 'a cancelled run keeps what it scanned');
        assert.equal(runner.calls.length, 2, 'B never ran');
    });

    test('cancel all stops the running items and starts none of the waiting ones', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.setConcurrency(2);
        queue.addItems([item('A'), item('B'), item('C'), item('D')]);
        assert.equal(queue.cancelAll(), 4);
        assert.equal(runner.calls.length, 2);
        for (const call of runner.calls) await settle(queue, call, { status: 'cancelled', payload: null });
        const session = onlySession(queue);
        assert.equal(session.state, 'finished');
        assert.deepEqual(session.items.map((i) => i.status), ['cancelled', 'cancelled', 'cancelled', 'cancelled']);
    });

    test('cancelling something outside the running queue is a 404', () => {
        const queue = newQueue(controlledRunner().executeRun);
        assert.throws(() => queue.cancelItem('nope'), (err) => err.statusCode === 404);
    });

    test('a new batch is refused while one runs; once idle, the next batch opens a new folder', async () => {
        const runner = controlledRunner();
        let clock = Date.parse('2026-10-12T10:00:00');
        const queue = newQueue(runner.executeRun, { now: () => clock });

        const first = queue.addItems([item('A'), item('B')]);
        assert.throws(() => queue.addItems([item('X')]),
            (err) => err.statusCode === 409 && /A batch is already running/.test(err.message));
        assert.equal(onlySession(queue).items.length, 2, 'nothing joined');

        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        await settle(queue, runner.calls[1], { status: 'done', payload: payloadWith() });

        clock += 5000;
        const second = queue.addItems([item('C')]);
        assert.notEqual(second.sessionId, first.sessionId);
        assert.deepEqual(queue.getState().sessions.map((s) => s.id), [second.sessionId, first.sessionId]);
    });

    test('names the session folder after the time it started, with a suffix on a clash', () => {
        const at = Date.parse('2026-10-12T14:03:27');
        assert.equal(files.createSessionDir(baseDir, at), '2026-10-12T14-03-27');
        assert.equal(files.createSessionDir(baseDir, at), '2026-10-12T14-03-27-2');
    });

    test('rejects the whole request when any item is invalid, queueing nothing', () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun, {
            validateUrl: (u) => { if (!/^https?:/.test(String(u))) throw new Error('Invalid url'); },
        });
        assert.throws(() => queue.addItems([item('A'), item('B', { url: 'ftp://x' })]),
            (err) => err.statusCode === 400 && /Item 2: Invalid url/.test(err.message));
        assert.throws(() => queue.addItems([{ run: { url: 'https://x.test/', actions: [] } }]),
            (err) => err.statusCode === 400 && /No actions/.test(err.message));
        assert.throws(() => queue.addItems([]), (err) => err.statusCode === 400);
        assert.equal(runner.calls.length, 0);
        assert.deepEqual(queue.getState().sessions, []);
    });

    test('drops the run spec once the item finishes', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.addItems([item('A')]);
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        const manifest = files.readManifest(path.join(baseDir, onlySession(queue).id));
        assert.equal('spec' in manifest.items[0], false);
    });

    test('keeps the newest sessions and removes older ones when a new session opens', async () => {
        const runner = controlledRunner();
        let clock = Date.parse('2026-10-12T10:00:00');
        const queue = newQueue(runner.executeRun, { now: () => clock, keepSessions: 2 });
        fs.mkdirSync(path.join(baseDir, 'not-a-session'));

        const ids = [];
        for (let i = 0; i < 3; i += 1) {
            ids.push(queue.addItems([item(`run ${i}`)]).sessionId);
            await settle(queue, runner.calls[i], { status: 'done', payload: payloadWith() });
            clock += 1000;
        }
        assert.deepEqual(files.listSessionIds(baseDir), [ids[2], ids[1]]);
        assert.ok(fs.existsSync(path.join(baseDir, 'not-a-session')), 'folders it did not make are left alone');
    });

    test('on startup, marks what a previous process left unfinished as interrupted', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const { sessionId } = queue.addItems([item('A'), item('B'), item('C')]);
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        // The process stops here: B running, C waiting.

        const restarted = createRunQueue({ baseDir, executeRun: controlledRunner().executeRun, logError: () => {} });
        assert.deepEqual(restarted.init(), [sessionId]);
        const session = restarted.getState().sessions[0];
        assert.equal(session.state, 'interrupted');
        assert.deepEqual(session.items.map((i) => i.status), ['done', 'interrupted', 'interrupted']);
    });

    test('resume runs a workflow kept in the older format in the current one', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const old = {
            url: 'https://example.com/', scenarioName: 'Old', tags: ['wcag2a', 'wcag21a', 'wcag22a'],
            actions: [{ type: 'click', selector: '#a', programmatic: 'true' }, { type: 'a11yScan', wcagLevel: 'AAA', timeout: 5000 }, { type: 'a11yScan' }],
        };
        const { sessionId } = queue.addItems([item('A', { config: { runSpec: old } }), item('B', { config: { runSpec: old } })]);
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });

        const next = controlledRunner();
        const restarted = createRunQueue({ baseDir, executeRun: next.executeRun, logError: () => {} });
        restarted.init();
        assert.deepEqual(restarted.resumeSession(sessionId), { sessionId, resumed: 1, stillWaiting: 0 });
        const { spec } = next.calls[0];
        // A run has no profile: the one its tags came to is on its scans.
        assert.equal('profile' in spec, false);
        assert.equal('tags' in spec, false);
        assert.deepEqual(spec.actions, [
            { type: 'click', selector: '#a', programmatic: true },
            { type: 'a11yScan', profile: 'wcag22-aaa', waitTimeout: 5000 },
            { type: 'a11yScan', profile: 'wcag22-a' },
        ]);
    });

    test('resume re-queues interrupted items into the same folder; items with masked values stay', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const configFor = (name, extra = {}) => ({ runSpec: { ...item(name).run, ...extra } });
        const { sessionId } = queue.addItems([
            item('A', { config: configFor('A') }),
            item('B', { config: configFor('B') }),
            item('C', { config: configFor('C', { actions: [{ type: 'type', text: undefined, textMasked: true }] }) }),
        ]);
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });

        const next = controlledRunner();
        const restarted = createRunQueue({ baseDir, executeRun: next.executeRun, logError: () => {} });
        restarted.init();
        assert.equal(restarted.getState().sessions[0].resumable, true);

        assert.deepEqual(restarted.resumeSession(sessionId), { sessionId, resumed: 1, stillWaiting: 1 });
        assert.equal(next.calls.length, 1);
        assert.equal(next.calls[0].spec.scenarioName, 'B');
        assert.deepEqual(restarted.getState().sessions[0].items.map((i) => i.status), ['done', 'running', 'interrupted']);

        await settle(restarted, next.calls[0], { status: 'done', payload: payloadWith() });
        const session = restarted.getState().sessions[0];
        assert.equal(session.id, sessionId);
        assert.deepEqual(session.items.map((i) => i.file), ['A.json', 'B.json', null]);
        assert.equal(session.items[2].needsValues, true);
        assert.equal(session.state, 'interrupted');
        assert.equal(session.resumable, true, 'C can resume once its value is typed again');
        assert.equal(session.needsValues, true);
    });

    test('resume asks once for each masked value the rows share, runs with it, and never saves it', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const workflow = {
            actions: [
                { type: 'goto', url: 'https://example.com/login' },
                { type: 'loop', children: [{ type: 'setValue', selector: '#pass', valueMasked: true }] },
                { type: 'runCustomStep', name: 'Login' },
            ],
            customSteps: [{ name: 'Login', actions: [{ type: 'setValue', labelText: 'PIN', valueMasked: true }] }],
        };
        const row = (name, n) => ({ ...item(name), row: n, config: { runSpec: { ...item(name).run, ...workflow } } });
        const { sessionId } = queue.addItems([item('Done first'), row('V1', 1), row('V2', 2)]);
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });

        const next = controlledRunner();
        const restarted = createRunQueue({ baseDir, executeRun: next.executeRun, logError: () => {} });
        restarted.init();
        assert.equal(restarted.getState().sessions[0].needsValues, true);

        const { fields } = restarted.getMaskedFields(sessionId);
        assert.deepEqual(fields.map(({ key, match, ...f }) => f), [
            { action: 'Set password value', field: 'Password', target: '#pass', where: 'Step 2 › 1', rows: 2,
                trail: ['Step 2: loop'], position: 'Step 1', before: [],
                runs: [{ name: 'V1', url: 'https://example.com/' }, { name: 'V2', url: 'https://example.com/' }] },
            { action: 'Set password value', field: 'Password', target: 'PIN', where: 'Custom step “Login” · Step 1', rows: 2,
                trail: ['Custom step “Login”'], position: 'Step 1', before: [],
                runs: [{ name: 'V1', url: 'https://example.com/' }, { name: 'V2', url: 'https://example.com/' }] },
        ]);
        assert.deepEqual(fields.map((f) => f.match), [
            { path: ['actions', 1, 'children', 0], field: 'value', step: { type: 'setPassword', selector: '#pass', valueMasked: true } },
            { path: ['customSteps', 0, 'actions', 0], field: 'value', step: { type: 'setPassword', labelText: 'PIN', valueMasked: true } },
        ], 'which step each one is, so the app can fill it in');

        // A value missing: nothing resumes, and the rows stay as they were.
        assert.throws(() => restarted.resumeSession(sessionId, { values: { [fields[0].key]: 'hunter2' } }),
            (err) => err.statusCode === 400 && /every hidden value/.test(err.message));
        assert.equal(next.calls.length, 0);

        const values = { [fields[0].key]: 'hunter2', [fields[1].key]: '4321' };
        assert.deepEqual(restarted.resumeSession(sessionId, { values }), { sessionId, resumed: 2, stillWaiting: 0 });
        const spec = next.calls[0].spec;
        assert.equal(spec.actions[1].children[0].value, 'hunter2');
        assert.equal(spec.customSteps[0].actions[0].value, '4321');

        const manifestText = fs.readFileSync(path.join(baseDir, sessionId, 'batch.json'), 'utf8');
        assert.ok(!manifestText.includes('hunter2') && !manifestText.includes('4321'), 'values never reach batch.json');

        await settle(restarted, next.calls[0], { status: 'done', payload: payloadWith({ extra: { actions: spec.actions } }) });
        const saved = fs.readdirSync(path.join(baseDir, sessionId))
            .filter((f) => f.endsWith('.json'))
            .map((f) => fs.readFileSync(path.join(baseDir, sessionId, f), 'utf8'));
        assert.ok(saved.every((text) => !text.includes('hunter2')), 'nor any saved result');
    });

    test('resume refuses while the queue is busy, an unknown session, and one with nothing to resume', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const { sessionId } = queue.addItems([item('A')]);
        assert.throws(() => queue.resumeSession(sessionId), (err) => err.statusCode === 409);
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        assert.throws(() => queue.resumeSession('../x'), (err) => err.statusCode === 404);
        assert.throws(() => queue.resumeSession('2020-01-01T00-00-00'), (err) => err.statusCode === 404);
        assert.throws(() => queue.resumeSession(sessionId), (err) => err.statusCode === 400);
    });

    test('deletes a finished session\'s folder, refuses the running one and anything that is not a session', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const { sessionId } = queue.addItems([item('A')]);
        assert.throws(() => queue.deleteSession(sessionId), (err) => err.statusCode === 409);
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });

        fs.mkdirSync(path.join(baseDir, 'keep-me'));
        assert.throws(() => queue.deleteSession('../keep-me'), (err) => err.statusCode === 404);
        assert.throws(() => queue.deleteSession('keep-me'), (err) => err.statusCode === 404);

        assert.deepEqual(queue.deleteSession(sessionId), { deleted: sessionId });
        assert.equal(fs.existsSync(path.join(baseDir, sessionId)), false);
        assert.deepEqual(queue.getState().sessions, []);
        assert.ok(fs.existsSync(path.join(baseDir, 'keep-me')));
        assert.throws(() => queue.deleteSession(sessionId), (err) => err.statusCode === 404);
    });

    describe('what runs saved beside their results', () => {
        let reportsRoot;
        beforeEach(() => {
            reportsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run-queue-reports-'));
        });
        afterEach(() => {
            fs.rmSync(reportsRoot, { recursive: true, force: true });
        });

        /** A run folder under the reports root, with a file in it. */
        function runFolder(kind, runId) {
            const dir = path.join(reportsRoot, kind, runId, 'elements-s0');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'el-1.png'), 'png');
            return path.join(reportsRoot, kind, runId);
        }

        /** A payload whose scan points at files in those run folders, as a run's does. */
        function payloadPointingAt(runId) {
            return payloadWith({ extra: { scans: [{
                scanId: 's0',
                summary: {},
                screenshots: [{ publicUrl: `/reports/runs/${runId}/scans/s0/scan-main.jpg` }],
                occurrences: [{ screenshot: { publicUrl: `/reports/evidence/${runId}/elements-s0/el-1.png` } }],
            }] } });
        }

        test('deleting a session removes the evidence and screenshots its runs saved, and nothing else', async () => {
            const runner = controlledRunner();
            const queue = newQueue(runner.executeRun, { reportsRoot });
            const { sessionId } = queue.addItems([item('A'), item('B')]);
            const evidenceA = runFolder('evidence', '2026-10-20T10-00-00-000Z');
            const shotsA = runFolder('runs', '2026-10-20T10-00-00-000Z');
            const evidenceB = runFolder('evidence', '2026-10-20T10-01-00-000Z');
            const someoneElse = runFolder('evidence', '2026-10-20T09-00-00-000Z');
            await settle(queue, runner.calls[0], { status: 'done', payload: payloadPointingAt('2026-10-20T10-00-00-000Z') });
            await settle(queue, runner.calls[1], { status: 'done', payload: payloadPointingAt('2026-10-20T10-01-00-000Z') });

            queue.deleteSession(sessionId);
            assert.equal(fs.existsSync(evidenceA), false);
            assert.equal(fs.existsSync(shotsA), false);
            assert.equal(fs.existsSync(evidenceB), false);
            assert.ok(fs.existsSync(someoneElse), 'a run of no batch keeps its evidence');
            assert.ok(fs.existsSync(path.join(reportsRoot, 'evidence')), 'the evidence folder itself stays');
        });

        test('a reference that would leave the reports root is ignored', async () => {
            const runner = controlledRunner();
            const queue = newQueue(runner.executeRun, { reportsRoot });
            const { sessionId } = queue.addItems([item('A')]);
            const outside = runFolder('evidence', 'x');
            await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith({ extra: { note: '/reports/evidence/../evidence/ /reports/evidence/../' } }) });

            queue.deleteSession(sessionId);
            assert.ok(fs.existsSync(outside));
            assert.ok(fs.existsSync(path.join(reportsRoot, 'evidence')));
        });

        test('old sessions removed to keep the newest go with their evidence too', async () => {
            const runner = controlledRunner();
            let clock = Date.parse('2026-10-12T10:00:00');
            const queue = newQueue(runner.executeRun, { now: () => clock, keepSessions: 1, reportsRoot });
            const first = runFolder('evidence', 'run-1');
            queue.addItems([item('A')]);
            await settle(queue, runner.calls[0], { status: 'done', payload: payloadPointingAt('run-1') });
            clock += 1000;
            const second = runFolder('evidence', 'run-2');
            queue.addItems([item('B')]);
            await settle(queue, runner.calls[1], { status: 'done', payload: payloadPointingAt('run-2') });

            assert.equal(fs.existsSync(first), false);
            assert.ok(fs.existsSync(second), 'the kept session keeps its evidence');
        });
    });

    test('a running run can be watched: its log from any index, the latest screenshots only', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.addItems([{ ...item('v2.4'), row: 2 }]);
        const [running] = onlySession(queue).items;
        const { progress } = runner.calls[0].hooks;
        progress({ type: 'info', message: 'browsing' });
        for (let i = 0; i < 20; i += 1) progress({ type: 'scan', message: 'a11yScan ready', extra: { dataUrl: `data:,${i}` } });

        const all = queue.getItemProgress(running.id, 0);
        assert.equal(all.status, 'running');
        assert.equal(all.name, 'v2.4');
        assert.equal(all.row, 2);
        assert.equal(all.scans, 20);
        assert.equal(all.logs.length, 21);
        assert.equal(all.nextIndex, 21);
        assert.equal(all.logs.filter((e) => e.extra && e.extra.dataUrl).length, 8);
        assert.deepEqual(queue.getItemProgress(running.id, 21).logs, []);
    });

    test('a finished run stays watchable for a moment, even once its session has closed', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const { sessionId } = queue.addItems([item('A')]);
        const [a] = onlySession(queue).items;
        runner.calls[0].hooks.progress({ type: 'info', message: 'last line' });
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        assert.equal(queue.getState().sessions[0].state, 'finished', 'the session closed');

        const after = queue.getItemProgress(a.id, 0);
        assert.equal(after.status, 'done');
        assert.equal(after.file, 'A.json');
        assert.equal(after.sessionId, sessionId);
        assert.deepEqual(after.logs.map((e) => e.message), ['last line']);
    });

    test('a run that is not running cannot be watched', () => {
        const queue = newQueue(controlledRunner().executeRun);
        queue.addItems([item('A'), item('B')]);
        const waiting = onlySession(queue).items[1];
        assert.throws(() => queue.getItemProgress(waiting.id), (err) => err.statusCode === 404);
        assert.throws(() => queue.getItemProgress('nope'), (err) => err.statusCode === 404);
    });

    test('sessionDir only answers for sessions that exist', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const { sessionId } = queue.addItems([item('A')]);
        assert.equal(queue.sessionDir(sessionId), path.join(baseDir, sessionId));
        assert.equal(queue.sessionDir('../etc'), null);
        assert.equal(queue.sessionDir('2020-01-01T00-00-00'), null);
    });

    test('a hidden value says the steps it sits inside and the steps just before it, never a hidden value', () => {
        const spec = {
            actions: [
                { type: 'click', label: 'Accept cookies', selector: '#accept-cookies' },
                { type: 'setValue', labelText: 'Email', value: 'jorge@shop.com' },
                { type: 'setValue', labelText: 'Old password', value: 'secret', valueMasked: true },
                { type: 'setValue', labelText: 'Password', valueMasked: true },
            ],
        };
        const slots = findMaskedSlots(spec);
        const last = describeMaskedSlot(spec, slots[1]);
        assert.equal(last.position, 'Step 4');
        assert.deepEqual(last.trail, []);
        assert.deepEqual(last.before, ['Set field value · Email = “jorge@shop.com”', 'Set password value · Old password = (hidden)']);
        assert.ok(!JSON.stringify(last).includes('secret'));
    });

    test('saves results without the values the user masked', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const { sessionId } = queue.addItems([item('login')]);
        const actions = [
            { type: 'setValue', selector: '#user', value: 'ana' },
            { type: 'setValue', selector: '#pass', value: 's3cret', valueMasked: true },
        ];
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith({ extra: { actions } }) });
        const text = fs.readFileSync(path.join(baseDir, sessionId, 'login.json'), 'utf8');
        assert.ok(!text.includes('s3cret'));
        assert.deepEqual(JSON.parse(text).actions[1], { type: 'setValue', selector: '#pass', valueMasked: true });
        assert.equal(JSON.parse(text).actions[0].value, 'ana');
    });

    test('passes a batch row\'s vars to the run, keeps them per item and writes them into the result', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const run = { ...item('v2.3').run, vars: { date: '2026-03-01', build: 2310 } };
        const { sessionId } = queue.addItems([{ run, row: 3 }]);
        assert.deepEqual(runner.calls[0].spec.vars, { date: '2026-03-01', build: 2310 });

        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        const [done] = onlySession(queue).items;
        assert.equal(done.row, 3);
        assert.deepEqual(done.vars, { date: '2026-03-01', build: 2310 });
        const saved = JSON.parse(fs.readFileSync(path.join(baseDir, sessionId, 'v2.3.json'), 'utf8'));
        assert.deepEqual(saved.vars, { date: '2026-03-01', build: 2310 });
    });

    test('rejects vars the engine cannot read, and sends none when a row sets none', () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        assert.throws(() => queue.addItems([item('a'), { run: { ...item('b').run, vars: { 'a.b': 1 } } }]),
            (err) => err.statusCode === 400 && /^Item 2: vars: "a\.b" is not a usable variable name/.test(err.message));
        queue.addItems([{ run: { ...item('c').run, vars: {} } }]);
        assert.equal('vars' in runner.calls[0].spec, false);
    });

    test('resume runs an interrupted batch row with its vars', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const run = { ...item('v2.4').run, vars: { date: '2026-06-15' } };
        const { sessionId } = queue.addItems([item('first'), { run, row: 2, config: { runSpec: run } }]);
        // Stops with the batch row still waiting.
        const next = controlledRunner();
        const restarted = createRunQueue({ baseDir, executeRun: next.executeRun, logError: () => {} });
        restarted.init();
        restarted.resumeSession(sessionId);
        assert.deepEqual(next.calls[0].spec.vars, { date: '2026-06-15' });
        assert.equal(restarted.getState().sessions[0].items[1].row, 2);
    });

    test('never leaves a temporary file behind', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const { sessionId } = queue.addItems([item('A')]);
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        const leftovers = fs.readdirSync(path.join(baseDir, sessionId)).filter((f) => f.startsWith('.'));
        assert.deepEqual(leftovers, []);
    });
});

describe('run queue live rows', () => {
    const step = (stepEvent, actionPath, actionType, label = null) => ({ type: 'info', message: '', extra: { stepEvent, actionPath, actionType, label } });
    const scanReady = () => ({ type: 'scan', message: 'a11yScan ready', extra: { summary: {} } });

    test('a running row says what it is doing, when it last scanned, and its pace', async () => {
        let t = Date.parse('2026-10-21T10:00:00Z');
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun, { now: () => t });
        queue.addItems([item('A')]);
        const row = () => onlySession(queue).items[0];
        assert.deepEqual([row().phase, row().activity, row().sinceScanMs, row().paceMs], ['running', null, null, null]);

        const { progress } = runner.calls[0].hooks;
        progress(step('action-start', '1', 'repeat'));
        progress({ type: 'info', message: '', extra: { stepEvent: 'loop-iteration', actionPath: '1', index: 0, total: 3 } });
        progress(step('action-start', '1.1', 'a11yScan', 'Home'));
        assert.equal(row().activity, 'Repeat 1 of 3 › A11y scan “Home”');
        for (const gap of [8000, 10000, 9000]) {
            t += gap;
            progress(scanReady());
        }
        t += 4000;
        assert.equal(row().sinceScanMs, 4000);
        assert.equal(row().sinceProgressMs, 4000);
        assert.equal(row().paceMs, 9000, 'the median gap between scans');
    });

    test('the running batch gives its scans a minute, from its runs\' pace', async () => {
        let t = Date.parse('2026-10-21T10:00:00Z');
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun, { now: () => t });
        queue.setConcurrency(2);
        queue.addItems([item('A'), item('B')]);
        assert.equal(onlySession(queue).scansPerMin, null, 'no scan yet');
        const [a, b] = runner.calls;
        for (let i = 0; i < 3; i += 1) {
            t += 6000; // A: one every 6 s, 10 a minute
            a.hooks.progress(scanReady());
            if (i % 2 === 0) b.hooks.progress(scanReady()); // B: after 6 s, then 12 s
        }
        assert.equal(onlySession(queue).items[1].paceMs, 9000, 'B: the median of 6 s and 12 s');
        assert.equal(onlySession(queue).scansPerMin, Math.round(60000 / 6000 + 60000 / 9000));
        assert.equal(onlySession(queue).mergedScansPerMin, null, 'no Merged scan: the report keeps every scan');
    });

    test('with Merged scans, the batch also gives the scans a minute the report keeps', async () => {
        let t = Date.parse('2026-10-21T10:00:00Z');
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun, { now: () => t });
        queue.setConcurrency(2);
        queue.addItems([item('A'), item('B')]);
        const [a, b] = runner.calls;
        const ready = (key) => ({ type: 'scan', message: 'a11yScan ready', extra: { mergedScanKey: key, summary: {} } });
        for (let i = 0; i < 6; i += 1) {
            t += 6000; // both: one every 6 s, 10 a minute
            a.hooks.progress(ready(`page-${Math.floor(i / 3)}`)); // A: three contexts a page
            b.hooks.progress(ready(null)); // B: no Merged scan
        }
        const s = onlySession(queue);
        assert.deepEqual(s.items.map((i) => [i.scans, i.scansRun]), [[2, 6], [6, 6]]);
        assert.equal(s.scansPerMin, 20);
        assert.equal(s.mergedScansPerMin, Math.round(10 / 3 + 10), 'A keeps one scan in three, B all of them');
    });

    test('watching a run gets the same details with its log', async () => {
        let t = Date.parse('2026-10-21T10:00:00Z');
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun, { now: () => t });
        queue.addItems([item('A')]);
        const { progress } = runner.calls[0].hooks;
        progress(step('action-start', '1', 'a11yScan', 'Home'));
        t += 5000;
        progress(scanReady());
        t += 2000;
        const watched = queue.getItemProgress(onlySession(queue).items[0].id, 0);
        assert.deepEqual([watched.phase, watched.activity, watched.sinceScanMs, watched.sinceProgressMs, watched.paceMs],
            ['running', 'A11y scan “Home”', 2000, 2000, 5000]);
    });

    test('says when the run is saving its result', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.addItems([item('A')]);
        runner.calls[0].hooks.progress({ type: 'info', message: 'Building the result', extra: { stepEvent: 'result-build' } });
        assert.equal(onlySession(queue).items[0].phase, 'saving');
        assert.equal(onlySession(queue).items[0].status, 'running');
    });
});

describe('deleting a run from a finished batch', () => {
    const saved = (name) => item(name, { config: { runSpec: item(name).run } });
    const PNG = (n) => Buffer.from([0x89, 0x50, 0x4e, 0x47, n]);
    const JPEG = (n) => `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, 0xff, 0xd9]).toString('base64')}`;

    // A, B and C done; A and B share a picture, A alone has another and its
    // own evidence.
    async function batchOfThree() {
        const reportsRoot = path.join(baseDir, 'reports');
        const evidence = path.join(reportsRoot, 'evidence', 'run-a', 'elements-scan');
        fs.mkdirSync(evidence, { recursive: true });
        fs.writeFileSync(path.join(evidence, 'element.png'), PNG(1));
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun, { reportsRoot });
        const { sessionId } = queue.addItems([saved('A'), saved('B'), saved('C')]);
        const a = payloadWith();
        a.scans[0].screenshots = [{ name: 'Shared', dataUrl: JPEG(7) }, { name: 'Own', dataUrl: JPEG(8) }];
        a.scans[0].canonical = { findings: [{ occurrences: [{ elementScreenshot: { url: '/reports/evidence/run-a/elements-scan/element.png' } }] }] };
        const b = payloadWith();
        b.scans[0].screenshots = [{ name: 'Shared', dataUrl: JPEG(7) }];
        await settle(queue, runner.calls[0], { status: 'done', payload: a });
        await settle(queue, runner.calls[1], { status: 'done', payload: b });
        await settle(queue, runner.calls[2], { status: 'done', payload: payloadWith() });
        await waitUntil(() => queue.getState().sessions[0].state !== 'running', 'the batch to finish');
        return { runner, queue, sessionId, reportsRoot, dir: files.sessionDirFor(baseDir, sessionId) };
    }
    const rows = (queue) => queue.getState().sessions[0].items;
    const pictures = (dir) => fs.readdirSync(path.join(dir, 'images')).sort();
    const picturesOf = (dir, file) => (fs.readFileSync(path.join(dir, file), 'utf8').match(/"images\/[^"]+"/g) || []).map((x) => x.slice(8, -1)).sort();

    test('removes its row, its result, and the pictures and evidence only it used', async () => {
        const { queue, sessionId, dir, reportsRoot } = await batchOfThree();
        const [a, b] = rows(queue);
        const aPictures = picturesOf(dir, a.file);
        const bPictures = picturesOf(dir, b.file);
        // Shared, its own, and its element's picture, copied from its evidence.
        assert.equal(aPictures.length, 3);
        assert.equal(pictures(dir).length, 3, 'the shared picture is kept once');

        const out = await queue.deleteItem(sessionId, a.id);
        assert.deepEqual({ ...out, sessionId: undefined }, { sessionId: undefined, deleted: a.id, remaining: 2, removedPictures: 2, removedRunFolders: 1 });
        assert.deepEqual(rows(queue).map((i) => i.name), ['B', 'C']);
        assert.deepEqual(files.readManifest(dir).items.map((i) => i.name), ['B', 'C']);
        assert.equal(fs.existsSync(path.join(dir, a.file)), false, 'its result is gone');
        assert.deepEqual(pictures(dir), bPictures, 'the picture B shares stays, A\'s own goes');
        assert.equal(fs.existsSync(path.join(reportsRoot, 'evidence', 'run-a')), false, 'its evidence goes');
        assert.ok(fs.existsSync(path.join(dir, b.file)));
    });

    test('a batch reopened after it reads without the run', async () => {
        const { queue, sessionId } = await batchOfThree();
        const [, b] = rows(queue);
        await queue.deleteItem(sessionId, b.id);
        const restarted = createRunQueue({ baseDir, executeRun: controlledRunner().executeRun, logError: () => {} });
        restarted.init();
        assert.deepEqual(restarted.getState().sessions[0].items.map((i) => i.name), ['A', 'C']);
    });

    test('not its only run, not a run it does not have, and not while a batch runs', async () => {
        const { queue, sessionId } = await batchOfThree();
        const [a, b, c] = rows(queue);
        await assert.rejects(queue.deleteItem(sessionId, 'nope'), (err) => err.statusCode === 404);
        await queue.deleteItem(sessionId, a.id);
        await queue.deleteItem(sessionId, b.id);
        await assert.rejects(queue.deleteItem(sessionId, c.id), (err) => err.statusCode === 409 && /only run/.test(err.message));
        queue.addItems([item('Other')]);
        await assert.rejects(queue.deleteItem(sessionId, c.id), (err) => err.statusCode === 409);
    });
});

describe('run queue: a batch kept as a report package', () => {
    test('saves a run\'s pictures in images/, the result naming them, and deletes its evidence with the batch', async () => {
        const reportsRoot = path.join(baseDir, 'reports');
        const evidenceDir = path.join(reportsRoot, 'evidence', 'run-1', 'elements-scan');
        fs.mkdirSync(evidenceDir, { recursive: true });
        fs.writeFileSync(path.join(evidenceDir, 'element-a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]));
        const element = '/reports/evidence/run-1/elements-scan/element-a.png';

        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun, { reportsRoot });
        queue.addItems([item('A')]);
        const payload = payloadWith();
        payload.scans[0].screenshots = [{ name: 'Main', dataUrl: 'data:image/jpeg;base64,/9j/4AAQ' }];
        payload.scans[0].canonical = { findings: [{ occurrences: [{ elementScreenshot: { url: element } }] }] };
        await settle(queue, runner.calls[0], { status: 'done', payload });

        const id = onlySession(queue).id;
        const dir = path.join(baseDir, id);
        const saved = fs.readFileSync(path.join(dir, 'A.json'), 'utf8');
        assert.ok(!saved.includes('/reports/') && !saved.includes('base64'), 'no link to the lab, no inline picture');
        const named = saved.match(/"images\/[^"]+"/g).map((s) => s.slice(1, -1));
        assert.equal(named.length, 2);
        for (const at of named) assert.ok(fs.existsSync(path.join(dir, at)), at);
        assert.deepEqual(files.readManifest(dir).items[0].runFolders, ['evidence/run-1']);

        queue.deleteSession(id);
        assert.equal(fs.existsSync(path.join(reportsRoot, 'evidence', 'run-1')), false, 'its evidence goes with it');
    });
});

describe('run queue spool', () => {
    test('gives each run a spool, and removes it once the result is saved', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.addItems([item('A')]);
        const { spool } = runner.calls[0].hooks;
        assert.ok(spool && typeof spool.spillScreenshot === 'function');
        await spool.spillScreenshot({ buffer: Buffer.from([1, 2, 3]) });
        assert.equal(path.dirname(spool.dir), path.join(baseDir, onlySession(queue).id));
        assert.equal(fs.existsSync(spool.dir), true);

        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        await waitUntil(() => !fs.existsSync(spool.dir), 'the spool to be removed');
        const left = fs.readdirSync(path.join(baseDir, onlySession(queue).id));
        assert.deepEqual(left.sort(), ['A.json', 'batch.json']);
    });

    test('removes the spool of a run that failed without a result', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.addItems([item('A')]);
        const { spool } = runner.calls[0].hooks;
        await spool.spillScreenshot({ buffer: Buffer.from([1, 2, 3]) });
        await settle(queue, runner.calls[0], { status: 'error', payload: null, error: { details: 'x' } });
        await waitUntil(() => !fs.existsSync(spool.dir), 'the spool to be removed');
    });

    test('on startup, removes spools a stopped server left', () => {
        const id = '2026-10-21T10-00-00';
        const dir = path.join(baseDir, id);
        fs.mkdirSync(path.join(dir, '.spool-abc'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.spool-abc', '1.jpg'), 'x');
        files.writeManifest(dir, { type: files.MANIFEST_TYPE, version: 1, id, items: [{ id: 'abc', status: 'running' }] });
        newQueue(() => new Promise(() => {}));
        assert.equal(fs.existsSync(path.join(dir, '.spool-abc')), false);
        assert.equal(files.readManifest(dir).items[0].status, 'interrupted');
    });
});

describe('run queue governor', () => {
    function heapSampler() {
        const sampler = { heapPct: 10, sample: async () => ({ heapPct: sampler.heapPct, heapUsedMb: sampler.heapPct * 40, heapLimitMb: 4000 }) };
        return sampler;
    }

    function metricsOf(queue) {
        const file = path.join(baseDir, onlySession(queue).id, files.METRICS_NAME);
        return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    }

    test('holds the next run while memory is high, and starts it once memory is down', async () => {
        const runner = controlledRunner();
        const sampler = heapSampler();
        const queue = newQueue(runner.executeRun, { resourceSampler: sampler, metricsIntervalMs: 5 });
        queue.setConcurrency(2);
        queue.addItems([item('A'), item('B'), item('C'), item('D')]);
        assert.equal(runner.calls.length, 2);
        await waitUntil(() => queue.getState().resources, 'a reading');
        assert.equal(queue.getState().hold, null);

        sampler.heapPct = 70;
        await waitUntil(() => queue.getState().hold, 'the hold');
        assert.deepEqual(queue.getState().hold.reason, 'memory');
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        assert.equal(runner.calls.length, 2, 'C is held: one run is still going');
        assert.deepEqual(onlySession(queue).items.map((i) => i.status), ['done', 'running', 'waiting', 'waiting']);

        sampler.heapPct = 55;
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(runner.calls.length, 2, 'between the marks, still held');

        sampler.heapPct = 40;
        await waitUntil(() => runner.calls.length === 3, 'C to start');
        assert.equal(queue.getState().hold, null);
        assert.equal(runner.calls.length, 3, 'one start: B and C make two again');

        await waitUntil(() => metricsOf(queue).some((r) => r.kind === 'resume'), 'the resume record');
        const records = metricsOf(queue);
        const hold = records.find((r) => r.kind === 'hold');
        assert.deepEqual([hold.heapPct, hold.holdAtPct, hold.resumeBelowPct], [70, 60, 50]);
        assert.ok(records.indexOf(hold) < records.findIndex((r) => r.kind === 'resume'));
    });

    test('with nothing running, the next run starts even while held', async () => {
        const runner = controlledRunner();
        const sampler = heapSampler();
        const queue = newQueue(runner.executeRun, { resourceSampler: sampler, metricsIntervalMs: 5 });
        queue.addItems([item('A'), item('B')]);
        sampler.heapPct = 90;
        await waitUntil(() => queue.getState().hold, 'the hold');
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        assert.equal(runner.calls.length, 2, 'B starts: nothing else would');
    });

    test('never holds a run already going, and leaves the setting alone', async () => {
        const runner = controlledRunner();
        const sampler = heapSampler();
        const queue = newQueue(runner.executeRun, { resourceSampler: sampler, metricsIntervalMs: 5 });
        queue.setConcurrency(3);
        queue.addItems([item('A'), item('B'), item('C')]);
        sampler.heapPct = 95;
        await waitUntil(() => queue.getState().hold, 'the hold');
        assert.equal(runner.calls.every((c) => !c.hooks.isCancelled() && !c.hooks.abortSignal.aborted), true);
        assert.equal(queue.getState().concurrency, 3);
    });

    test('holds even with the metrics file turned off', async () => {
        const runner = controlledRunner();
        const sampler = heapSampler();
        const queue = newQueue(runner.executeRun, { resourceSampler: sampler, metricsIntervalMs: 5, writeMetrics: false });
        queue.setConcurrency(2);
        queue.addItems([item('A'), item('B'), item('C')]);
        sampler.heapPct = 80;
        await waitUntil(() => queue.getState().hold, 'the hold');
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        assert.equal(runner.calls.length, 2);
        assert.deepEqual(metricsOf(queue), []);
    });

    test('a finished batch keeps its memory peak and how often it held a run, in batch.json', async () => {
        const runner = controlledRunner();
        const sampler = heapSampler();
        const queue = newQueue(runner.executeRun, { resourceSampler: sampler, metricsIntervalMs: 5 });
        queue.setConcurrency(2);
        queue.addItems([item('A'), item('B')]);
        sampler.heapPct = 72;
        await waitUntil(() => queue.getState().hold, 'the hold');
        sampler.heapPct = 30;
        await waitUntil(() => !queue.getState().hold, 'the resume');
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        await settle(queue, runner.calls[1], { status: 'done', payload: payloadWith() });
        const stats = onlySession(queue).stats;
        assert.deepEqual(stats, { peakHeapPct: 72, peakHeapMb: 2880, heapLimitMb: 4000, holds: 1 });
        assert.deepEqual(files.readManifest(path.join(baseDir, onlySession(queue).id)).stats, stats);
    });

    test('no batch, no hold or reading', async () => {
        const runner = controlledRunner();
        const sampler = heapSampler();
        const queue = newQueue(runner.executeRun, { resourceSampler: sampler, metricsIntervalMs: 5 });
        queue.addItems([item('A')]);
        sampler.heapPct = 90;
        await waitUntil(() => queue.getState().hold, 'the hold');
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        assert.equal(queue.getState().hold, null);
        assert.equal(queue.getState().resources, null);
    });
});

describe('run queue metrics', () => {
    const scanReady = (durationMs) => ({
        type: 'scan', message: 'a11yScan ready', extra: { summary: { failCount: 1 }, meta: { durationMs } },
    });

    function metricsOf(queue) {
        const file = path.join(baseDir, onlySession(queue).id, files.METRICS_NAME);
        if (!fs.existsSync(file)) return [];
        return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    }

    function fakeSampler() {
        let n = 0;
        return {
            sample: async () => ({ heapUsedMb: (n += 1), heapPct: n }),
            host: () => ({ platform: 'test', cpus: 2 }),
        };
    }

    test('writes no metrics file without a sampler', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        queue.addItems([item('A')]);
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        assert.deepEqual(metricsOf(queue), []);
    });

    test('logs the session, each run start, scan and end, and resource samples', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun, { resourceSampler: fakeSampler(), metricsIntervalMs: 5 });
        queue.setConcurrency(2);
        queue.addItems([item('A'), item('B')]);
        const [a, b] = runner.calls;
        a.hooks.progress(scanReady(120));
        a.hooks.progress(scanReady(80));
        b.hooks.progress(scanReady(50));
        b.hooks.progress({ type: 'step', message: 'click' });

        await waitUntil(() => metricsOf(queue).some((r) => r.kind === 'sample' && r.running === 2), 'a sample');
        await settle(queue, a, { status: 'done', payload: payloadWith() });
        await settle(queue, b, { status: 'error', payload: payloadWith() });
        await waitUntil(() => metricsOf(queue).some((r) => r.kind === 'session-end'), 'the session to end');

        const records = metricsOf(queue);
        const kinds = records.map((r) => r.kind);
        assert.equal(kinds[0], 'session');
        assert.deepEqual(records[0].host, { platform: 'test', cpus: 2 });
        assert.equal(kinds[kinds.length - 1], 'session-end');
        assert.ok(records.every((r) => Number.isFinite(Date.parse(r.t))));

        const ids = onlySession(queue).items.map((i) => i.id);
        const starts = records.filter((r) => r.kind === 'run-start');
        assert.deepEqual(starts.map((r) => [r.item, r.name, r.running]), [[ids[0], 'A', 1], [ids[1], 'B', 2]]);

        const scans = records.filter((r) => r.kind === 'scan');
        assert.deepEqual(scans.map((r) => [r.item, r.scan, r.scanMs, r.running]), [
            [ids[0], 1, 120, 2], [ids[0], 2, 80, 2], [ids[1], 1, 50, 2],
        ]);
        assert.ok(scans.every((r) => Number.isFinite(r.sinceLastMs) && r.sinceLastMs >= 0));

        const sample = records.find((r) => r.kind === 'sample' && r.running === 2);
        assert.equal(sample.concurrency, 2);
        assert.equal(sample.waiting, 0);
        assert.ok(sample.heapUsedMb >= 1);
        assert.deepEqual(sample.runs.map((r) => r.item).sort(), [...ids].sort());

        const endsAt = records.filter((r) => r.kind === 'run-end').map((r) => [r.item, r.status, r.running]);
        assert.deepEqual(endsAt, [[ids[0], 'done', 1], [ids[1], 'error', 0]]);
    });

    test('a sampler that fails is logged and the batch carries on', async () => {
        const runner = controlledRunner();
        const errors = [];
        const queue = newQueue(runner.executeRun, {
            resourceSampler: { sample: async () => { throw new Error('ps gone'); } },
            metricsIntervalMs: 5,
            logError: (msg) => errors.push(msg),
        });
        queue.addItems([item('A')]);
        await waitUntil(() => errors.length > 0, 'the failed sample');
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith() });
        assert.equal(onlySession(queue).items[0].status, 'done');
        assert.match(errors[0], /could not sample/);
    });
});

describe('run queue helpers', () => {
    test('hasMaskedValues finds a masked flag anywhere in a spec', () => {
        assert.equal(hasMaskedValues({ actions: [{ type: 'click' }] }), false);
        assert.equal(hasMaskedValues({ actions: [{ children: [{ valueMasked: true }] }] }), true);
        assert.equal(hasMaskedValues({ actions: [{ valueMasked: false }] }), false);
        assert.equal(hasMaskedValues(null), false);
    });

    test('summarizePayload copes with a payload missing its findings', () => {
        assert.deepEqual(summarizePayload({}), {
            scans: 0,
            scansRun: 0,
            findings: { fail: 0, cantTell: 0, pass: 0 },
        });
    });

    test('fileStem keeps names readable and safe', () => {
        assert.equal(files.fileStem('Product v2.3 (beta)'), 'Product-v2.3-beta');
        assert.equal(files.fileStem('Página de inicio'), 'Pagina-de-inicio');
        assert.equal(files.fileStem('...'), 'run');
        assert.equal(files.fileStem('a'.repeat(200)).length, 80);
    });

    test('sorts sessions newest first, with -10 after -9', () => {
        for (const id of ['2026-10-12T10-00-00', '2026-10-12T10-00-00-9', '2026-10-12T10-00-00-10', '2026-10-11T23-59-59']) {
            fs.mkdirSync(path.join(baseDir, id));
            fs.writeFileSync(path.join(baseDir, id, 'batch.json'), '{}');
        }
        assert.deepEqual(files.listSessionIds(baseDir), [
            '2026-10-12T10-00-00-10', '2026-10-12T10-00-00-9', '2026-10-12T10-00-00', '2026-10-11T23-59-59',
        ]);
    });
});

describe('changing a run that has ended while its batch still runs', () => {
    const saved = (name) => item(name, { config: { runSpec: item(name).run } });
    const live = (queue) => queue.getState().sessions.find((s) => s.state === 'running');
    const row = (queue, name) => queue.getState().sessions[0].items.find((i) => i.name === name);
    const failed = { status: 'error', payload: null, error: { details: 'Site down' } };

    test('a failed run is run again at once, before the rows still waiting', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const { sessionId } = queue.addItems([saved('A'), saved('B'), saved('C')]);
        await settle(queue, runner.calls[0], failed);
        assert.equal(row(queue, 'A').status, 'error');

        assert.deepEqual(queue.rerunItem(sessionId, row(queue, 'A').id), { sessionId, itemId: row(queue, 'A').id });
        assert.equal(row(queue, 'A').status, 'waiting');
        assert.equal(runner.calls.length, 2, 'B holds the one slot');
        // A run still going is not run again, nor deleted.
        assert.throws(() => queue.rerunItem(sessionId, row(queue, 'B').id), (err) => err.statusCode === 409 && /not finished/.test(err.message));
        await assert.rejects(queue.deleteItem(sessionId, row(queue, 'B').id), (err) => err.statusCode === 409);

        await settle(queue, runner.calls[1], { status: 'done', payload: payloadWith() });
        assert.equal(runner.calls[2].spec.scenarioName, 'A', 'the re-run goes before C');
        await settle(queue, runner.calls[2], { status: 'done', payload: payloadWith({ scans: [{ fail: 2 }] }) });
        const a = row(queue, 'A');
        assert.deepEqual([a.status, a.findings.fail, a.reruns, a.candidate], ['done', 2, 1, null], 'nothing to replace: the result is the row\'s');
        assert.equal(live(queue).id, sessionId, 'the batch still runs C');
        await settle(queue, runner.calls[3], { status: 'done', payload: payloadWith() });
        await waitUntil(() => !live(queue), 'the batch to finish');
        const manifest = files.readManifest(files.sessionDirFor(baseDir, sessionId));
        assert.deepEqual(manifest.items.map((i) => i.status), ['done', 'done', 'done']);
        assert.ok(manifest.items[0].file);
    });

    test('a failed run is deleted from the batch, which carries on', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const { sessionId } = queue.addItems([saved('A'), saved('B')]);
        await settle(queue, runner.calls[0], failed);
        await queue.deleteItem(sessionId, row(queue, 'A').id);
        assert.deepEqual(live(queue).items.map((i) => i.name), ['B']);
        const dir = files.sessionDirFor(baseDir, sessionId);
        assert.deepEqual(files.readManifest(dir).items.map((i) => i.name), ['B'], 'written at once');
        await settle(queue, runner.calls[1], { status: 'done', payload: payloadWith() });
        await waitUntil(() => !live(queue), 'the batch to finish');
        assert.deepEqual(files.readManifest(dir).items.map((i) => i.name), ['B']);
    });

    test('a re-run\'s result is chosen while the batch still runs', async () => {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const { sessionId } = queue.addItems([saved('A'), saved('B'), saved('C')]);
        const dir = files.sessionDirFor(baseDir, sessionId);
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith({ scans: [{ fail: 3 }] }) });
        const first = row(queue, 'A').file;
        queue.rerunItem(sessionId, row(queue, 'A').id);
        await settle(queue, runner.calls[1], { status: 'done', payload: payloadWith() });
        await settle(queue, runner.calls[2], { status: 'done', payload: payloadWith({ scans: [{ fail: 1 }] }) });
        const a = row(queue, 'A');
        assert.deepEqual([a.file, a.findings.fail, a.candidate.findings.fail], [first, 3, 1], 'the re-run waits beside the active one');
        assert.ok(live(queue), 'C runs');

        await queue.chooseRerunResult(sessionId, a.id, 'new');
        const now = row(queue, 'A');
        assert.deepEqual([now.file, now.findings.fail, now.candidate], [a.candidate.file, 1, null]);
        assert.ok(!fs.existsSync(path.join(dir, first)), 'the old result is let go');
        await settle(queue, runner.calls[3], { status: 'done', payload: payloadWith() });
        await waitUntil(() => !live(queue), 'the batch to finish');
        assert.equal(files.readManifest(dir).items[0].file, a.candidate.file);
    });
});

describe('changing a finished batch', () => {
    const saved = (name) => item(name, { config: { runSpec: item(name).run } });

    async function finishedBatch() {
        const runner = controlledRunner();
        const queue = newQueue(runner.executeRun);
        const { sessionId } = queue.addItems([saved('A'), saved('B')]);
        await settle(queue, runner.calls[0], { status: 'done', payload: payloadWith({ scans: [{ fail: 3 }] }) });
        await settle(queue, runner.calls[1], { status: 'done', payload: payloadWith({ scans: [{ fail: 1 }] }) });
        await waitUntil(() => queue.getState().sessions[0].state !== 'running', 'the batch to finish');
        return { runner, queue, sessionId, dir: files.sessionDirFor(baseDir, sessionId) };
    }
    const rows = (queue) => queue.getState().sessions[0].items;

    const resultsOnDisk = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'batch.json').sort();

    // A row run again, its re-run finished with `fail` failures.
    async function ranAgain(queue, runner, sessionId, at = 0, fail = 2) {
        const before = runner.calls.length;
        queue.rerunItem(sessionId, rows(queue)[at].id);
        await settle(queue, runner.calls[before], { status: 'done', payload: payloadWith({ scans: [{ fail: 0 }, { fail }] }) });
        await waitUntil(() => queue.getState().sessions[0].state !== 'running', 'the re-run to finish');
        return rows(queue)[at];
    }

    test('a row run again shows its active result beside the run, and then waits for a choice, keeping the active one', async () => {
        const { runner, queue, sessionId, dir } = await finishedBatch();
        const [a] = rows(queue);
        queue.rerunItem(sessionId, a.id);
        assert.equal(runner.calls.length, 3);
        assert.equal(runner.calls[2].spec.scenarioName, 'A');
        const running = rows(queue)[0];
        assert.equal(running.status, 'running');
        assert.deepEqual([running.active.file, running.active.findings.fail, running.active.finishedAt], [a.file, 3, a.finishedAt], 'the active result, shown above the run');
        await settle(queue, runner.calls[2], { status: 'done', payload: payloadWith({ scans: [{ fail: 0 }, { fail: 2 }] }) });
        await waitUntil(() => queue.getState().sessions[0].state !== 'running', 'the re-run to finish');

        const [row, b] = rows(queue);
        assert.equal(row.id, a.id);
        assert.deepEqual([row.status, row.file, row.findings.fail, row.finishedAt, row.ranAgain], ['done', a.file, 3, a.finishedAt, false], 'still the active result');
        assert.deepEqual([row.candidate.status, row.candidate.scans, row.candidate.findings.fail, row.candidate.ranAgain], ['done', 2, 2, true]);
        assert.ok(Date.parse(row.candidate.finishedAt) >= Date.parse(a.finishedAt));
        assert.equal(row.active, null);
        assert.deepEqual([row.reruns, row.lastRerun.status, row.lastRerun.kept], [1, 'done', 'pending']);
        assert.equal(b.findings.fail, 1, 'the other row is as it was');
        assert.deepEqual(resultsOnDisk(dir), [a.file, b.file, row.candidate.file].sort(), 'both results kept until the choice');
        assert.equal(queue.getState().sessions[0].counts.total, 2);

        // Until the choice: no other re-run, no delete.
        assert.throws(() => queue.rerunItem(sessionId, a.id), (err) => err.statusCode === 409 && /choose/.test(err.message));
        await assert.rejects(queue.deleteItem(sessionId, a.id), (err) => err.statusCode === 409);

        // The choice survives a restart.
        const restarted = createRunQueue({ baseDir, executeRun: controlledRunner().executeRun, logError: () => {} });
        restarted.init();
        assert.equal(restarted.getState().sessions[0].items[0].candidate.file, row.candidate.file);
    });

    test('keeping the new one makes it the row\'s result, says it ran again, and lets the old one go', async () => {
        const { runner, queue, sessionId, dir } = await finishedBatch();
        const [a, b] = rows(queue);
        const row = await ranAgain(queue, runner, sessionId);
        const r = await queue.chooseRerunResult(sessionId, a.id, 'new');
        assert.equal(r.kept, 'new');
        const [now] = rows(queue);
        assert.deepEqual([now.file, now.findings.fail, now.scans, now.ranAgain, now.candidate, now.finishedAt], [row.candidate.file, 2, 2, true, null, row.candidate.finishedAt]);
        assert.deepEqual(resultsOnDisk(dir), [b.file, row.candidate.file].sort());
        assert.equal(files.readManifest(dir).items[0].file, row.candidate.file);
        // Run again and Delete are back.
        assert.doesNotThrow(() => queue.rerunItem(sessionId, a.id));
    });

    test('keeping the active one lets the re-run\'s result go', async () => {
        const { runner, queue, sessionId, dir } = await finishedBatch();
        const [a, b] = rows(queue);
        const row = await ranAgain(queue, runner, sessionId);
        await queue.chooseRerunResult(sessionId, a.id, 'active');
        const [now] = rows(queue);
        assert.deepEqual([now.file, now.findings.fail, now.ranAgain, now.candidate, now.versions], [a.file, 3, false, null, []]);
        assert.deepEqual(resultsOnDisk(dir), [a.file, b.file].sort());
        assert.ok(!resultsOnDisk(dir).includes(row.candidate.file));
    });

    test('keeping both keeps the re-run\'s result as a version: one can be made active, and one let go', async () => {
        const { runner, queue, sessionId, dir } = await finishedBatch();
        const [a, b] = rows(queue);
        const row = await ranAgain(queue, runner, sessionId);
        await queue.chooseRerunResult(sessionId, a.id, 'both');
        let [now] = rows(queue);
        assert.deepEqual([now.file, now.findings.fail], [a.file, 3], 'the active one stays active');
        assert.deepEqual(now.versions.map((v) => [v.file, v.findings.fail, v.ranAgain]), [[row.candidate.file, 2, true]]);
        assert.equal(resultsOnDisk(dir).length, 3);

        await queue.activateVersion(sessionId, a.id, row.candidate.file);
        [now] = rows(queue);
        assert.deepEqual([now.file, now.findings.fail, now.ranAgain], [row.candidate.file, 2, true], 'the batch counts this one now');
        assert.deepEqual(now.versions.map((v) => [v.file, v.findings.fail, v.ranAgain]), [[a.file, 3, false]]);
        assert.deepEqual(files.readManifest(dir).items[0].versions.map((v) => v.file), [a.file]);

        await assert.rejects(queue.deleteVersion(sessionId, a.id, row.candidate.file), (err) => err.statusCode === 404, 'not the active one');
        await queue.deleteVersion(sessionId, a.id, a.file);
        [now] = rows(queue);
        assert.deepEqual(now.versions, []);
        assert.deepEqual(resultsOnDisk(dir), [b.file, row.candidate.file].sort());
    });

    test('a row keeps five results at most: the active one and four versions', async () => {
        const { runner, queue, sessionId } = await finishedBatch();
        const [a] = rows(queue);
        for (let i = 0; i < 4; i += 1) {
            await ranAgain(queue, runner, sessionId, 0, i);
            await queue.chooseRerunResult(sessionId, a.id, 'both');
        }
        assert.equal(rows(queue)[0].versions.length, 4);
        await ranAgain(queue, runner, sessionId, 0, 9);
        await assert.rejects(queue.chooseRerunResult(sessionId, a.id, 'both'), (err) => err.statusCode === 409 && /5 results/.test(err.message));
        assert.ok(rows(queue)[0].candidate, 'still waiting for a choice');
        await queue.chooseRerunResult(sessionId, a.id, 'active');
        assert.equal(rows(queue)[0].candidate, null);
    });

    test('a choice needs a re-run\'s result to choose, and says what to keep', async () => {
        const { queue, sessionId } = await finishedBatch();
        const [a] = rows(queue);
        await assert.rejects(queue.chooseRerunResult(sessionId, a.id, 'new'), (err) => err.statusCode === 409);
        await assert.rejects(queue.chooseRerunResult(sessionId, a.id, 'all'), (err) => err.statusCode === 400);
        await assert.rejects(queue.activateVersion(sessionId, a.id, 'nope.json'), (err) => err.statusCode === 404);
    });

    test('deleting a row takes its versions with it', async () => {
        const { runner, queue, sessionId, dir } = await finishedBatch();
        const [a, b] = rows(queue);
        await ranAgain(queue, runner, sessionId);
        await queue.chooseRerunResult(sessionId, a.id, 'both');
        await queue.deleteItem(sessionId, a.id);
        assert.deepEqual(resultsOnDisk(dir), [b.file]);
    });

    test('a batch saved before results said whether they came from a re-run: one that replaced the result did', async () => {
        const { queue, sessionId, dir } = await finishedBatch();
        const manifest = files.readManifest(dir);
        delete manifest.items[0].ranAgain;
        manifest.items[0].reruns = 1;
        manifest.items[0].lastRerun = { at: '2026-11-06T10:00:00.000Z', status: 'done', error: null };
        delete manifest.items[1].ranAgain;
        files.writeManifest(dir, manifest);
        const reread = createRunQueue({ baseDir, executeRun: controlledRunner().executeRun, logError: () => {} });
        reread.init();
        assert.deepEqual(reread.getState().sessions[0].items.map((i) => i.ranAgain), [true, false]);
        assert.ok(sessionId);
    });

    test('a row run again leaves the batch\'s own times as they were', async () => {
        const { runner, queue, sessionId, dir } = await finishedBatch();
        const before = queue.getState().sessions[0];
        assert.ok(before.finishedAt);
        await new Promise((r) => setTimeout(r, 15));
        queue.rerunItem(sessionId, rows(queue)[0].id);
        assert.equal(queue.getState().sessions[0].finishedAt, null, 'running again meanwhile');
        assert.equal(files.readManifest(dir).keepFinishedAt, before.finishedAt, 'kept, in case of a restart');
        await settle(queue, runner.calls[2], { status: 'done', payload: payloadWith() });
        await waitUntil(() => queue.getState().sessions[0].state !== 'running', 'the re-run to finish');
        const after = queue.getState().sessions[0];
        assert.deepEqual([after.startedAt, after.finishedAt], [before.startedAt, before.finishedAt]);
        const manifest = files.readManifest(dir);
        assert.deepEqual([manifest.startedAt, manifest.finishedAt, manifest.keepFinishedAt], [before.startedAt, before.finishedAt, undefined]);
        assert.ok(Date.parse(rows(queue)[0].candidate.finishedAt) > Date.parse(before.finishedAt), 'the re-run says when it ran');
    });

    test('a re-run a restart cuts short leaves the batch\'s own times too', async () => {
        const { queue, sessionId } = await finishedBatch();
        const before = queue.getState().sessions[0];
        queue.rerunItem(sessionId, rows(queue)[0].id);
        const restarted = createRunQueue({ baseDir, executeRun: controlledRunner().executeRun, logError: () => {} });
        restarted.init();
        const s = restarted.getState().sessions[0];
        assert.deepEqual([s.startedAt, s.finishedAt], [before.startedAt, before.finishedAt]);
    });

    test('a re-run that ends with no result keeps the old one, and says so', async () => {
        const { runner, queue, sessionId } = await finishedBatch();
        const [a] = rows(queue);
        queue.rerunItem(sessionId, a.id);
        await settle(queue, runner.calls[2], { status: 'error', payload: null, error: { details: 'Site down' } });
        await waitUntil(() => queue.getState().sessions[0].state !== 'running', 'the re-run to end');
        const [kept] = rows(queue);
        assert.deepEqual([kept.status, kept.file, kept.findings.fail, kept.finishedAt], ['done', a.file, 3, a.finishedAt]);
        assert.deepEqual([kept.lastRerun.status, kept.lastRerun.error], ['error', 'Site down']);
    });

    test('a re-run cut short by a restart leaves the old result standing', async () => {
        const { queue, sessionId } = await finishedBatch();
        const [a] = rows(queue);
        queue.rerunItem(sessionId, a.id);
        const restarted = createRunQueue({ baseDir, executeRun: controlledRunner().executeRun, logError: () => {} });
        restarted.init();
        const [kept] = restarted.getState().sessions[0].items;
        assert.deepEqual([kept.status, kept.file, kept.lastRerun.status], ['done', a.file, 'interrupted']);
    });

    test('a row added as a report by an earlier copy of the lab is not run again: it kept no workflow', async () => {
        const { queue, sessionId, dir } = await finishedBatch();
        const manifest = files.readManifest(dir);
        manifest.items[1].imported = { at: '2026-11-05T10:00:00.000Z', missingPictures: 0 };
        files.writeManifest(dir, manifest);
        const reread = createRunQueue({ baseDir, executeRun: controlledRunner().executeRun, logError: () => {} });
        reread.init();
        assert.throws(() => reread.rerunItem(sessionId, manifest.items[1].id), /added as a report/);
        assert.ok(reread.getState().sessions[0].items[1].imported, 'still shown as added');
    });

    test('not while another batch runs', async () => {
        const { runner, queue, sessionId } = await finishedBatch();
        queue.addItems([item('Other')]);
        assert.throws(() => queue.rerunItem(sessionId, rows(queue)[0].id), (err) => err.statusCode === 409);
        await assert.rejects(queue.deleteItem(sessionId, rows(queue)[0].id), (err) => err.statusCode === 409);
        assert.equal(runner.calls.length, 3);
    });

    test('a finished batch takes no runs added to it: it is the batch it was', () => {
        const queue = newQueue(controlledRunner().executeRun);
        assert.equal(queue.addToSession, undefined);
        assert.equal(queue.importReport, undefined);
    });
});
