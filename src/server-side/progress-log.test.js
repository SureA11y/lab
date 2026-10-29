'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createProgressLog, KEEP_SCREENSHOTS } = require('./progress-log');

const scan = (n) => ({ type: 'scan', message: 'a11yScan ready', extra: { label: `scan ${n}`, dataUrl: `data:image/jpeg;base64,${n}` } });
const info = (n) => ({ type: 'info', message: `step ${n}` });

describe('progress log', () => {
    test('keeps every text entry, in order, with absolute indexes', () => {
        const log = createProgressLog();
        for (let i = 0; i < 5; i += 1) log.push(info(i));
        assert.deepEqual(log.slice(0).logs.map((e) => e.message), ['step 0', 'step 1', 'step 2', 'step 3', 'step 4']);
        assert.equal(log.slice(3).logs.length, 2);
        assert.equal(log.slice(3).nextIndex, 5);
    });

    test('only the latest screenshots keep their image; older ones keep their line', () => {
        const log = createProgressLog();
        for (let i = 0; i < 300; i += 1) log.push(scan(i));
        const { logs } = log.slice(0);
        assert.equal(logs.length, 300, 'no line is lost');
        const withImage = logs.filter((e) => e.extra.dataUrl);
        assert.equal(withImage.length, KEEP_SCREENSHOTS);
        assert.deepEqual(withImage.map((e) => e.extra.label), Array.from({ length: KEEP_SCREENSHOTS }, (_, k) => `scan ${300 - KEEP_SCREENSHOTS + k}`));
        assert.deepEqual(logs[0].extra, { label: 'scan 0', screenshotDropped: true });
    });

    test('dropping an image never edits the entry the runner handed in', () => {
        const log = createProgressLog({ keepScreenshots: 1 });
        const first = scan(1);
        log.push(first);
        log.push(scan(2));
        assert.equal(first.extra.dataUrl, 'data:image/jpeg;base64,1');
        assert.equal(log.slice(0).logs[0].extra.dataUrl, undefined);
    });

    test('past the entry cap the oldest lines go, and indexes keep counting', () => {
        const log = createProgressLog({ maxEntries: 3 });
        for (let i = 0; i < 5; i += 1) log.push(info(i));
        assert.equal(log.size, 3);
        assert.equal(log.nextIndex, 5);
        assert.deepEqual(log.slice(0).logs.map((e) => e.message), ['step 2', 'step 3', 'step 4'], 'a reader that fell behind gets what is left');
        assert.deepEqual(log.slice(4).logs.map((e) => e.message), ['step 4']);
        assert.deepEqual(log.slice(5).logs, []);
    });

    test('images and the entry cap work together', () => {
        const log = createProgressLog({ maxEntries: 4, keepScreenshots: 2 });
        for (let i = 0; i < 10; i += 1) log.push(scan(i));
        const { logs } = log.slice(0);
        assert.deepEqual(logs.map((e) => e.extra.label), ['scan 6', 'scan 7', 'scan 8', 'scan 9']);
        assert.deepEqual(logs.map((e) => !!e.extra.dataUrl), [false, false, true, true]);
    });

    test('ignores what is not an entry', () => {
        const log = createProgressLog();
        log.push(null);
        log.push('x');
        assert.equal(log.size, 0);
    });
});
