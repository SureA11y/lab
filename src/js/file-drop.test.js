'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

let D;
async function load() {
    if (!D) D = await import('./file-drop.js');
    return D;
}

const file = (name, type = '') => ({ name, type });
const REPORTS = '.a11y-report.json,.json,application/json,.zip,application/zip';

describe('file drop', () => {
    test('acceptsFile reads an input accept list by extension or type', async () => {
        const { acceptsFile } = await load();
        assert.equal(acceptsFile(file('run.a11y-report.json'), REPORTS), true);
        assert.equal(acceptsFile(file('RUN.JSON'), REPORTS), true, 'extensions in any case');
        assert.equal(acceptsFile(file('batch', 'application/zip'), REPORTS), true, 'by type when the name says nothing');
        assert.equal(acceptsFile(file('notes.txt', 'text/plain'), REPORTS), false);
        assert.equal(acceptsFile(file('shot.png', 'image/png'), 'image/*'), true);
        assert.equal(acceptsFile(file('anything'), ''), true, 'no accept list takes anything');
    });

    test('checkDrop loads what the zone takes', async () => {
        const { checkDrop } = await load();
        const files = [file('a.json'), file('b.zip')];
        assert.deepEqual(checkDrop(files, { accept: REPORTS, multiple: true, kind: 'a report' }), { ok: true, files });
    });

    test('checkDrop loads nothing when any file is of another kind, and names it', async () => {
        const { checkDrop } = await load();
        assert.deepEqual(checkDrop([file('a.json'), file('notes.txt'), file('b.png')], { accept: REPORTS, multiple: true, kind: 'a JSON report' }),
            { ok: false, message: 'Nothing loaded: notes.txt, b.png are not a JSON report.' });
        assert.deepEqual(checkDrop([file('notes.txt')], { accept: REPORTS, multiple: true, kind: 'a JSON report' }),
            { ok: false, message: 'Nothing loaded: notes.txt is not a JSON report.' });
    });

    test('checkDrop takes one file where the zone takes one', async () => {
        const { checkDrop } = await load();
        assert.deepEqual(checkDrop([file('a.json'), file('b.json')], { accept: '.json', multiple: false, kind: 'a configuration' }),
            { ok: false, message: 'Nothing loaded: drop one file here, not 2.' });
    });

    test('checkDrop refuses folders and empty drops', async () => {
        const { checkDrop } = await load();
        assert.deepEqual(checkDrop([file('reports')], { accept: REPORTS, multiple: true, kind: 'a report', folders: ['reports'] }),
            { ok: false, message: 'Folders cannot be loaded (reports). Drop the files inside instead.' });
        assert.equal(checkDrop([], { accept: REPORTS, multiple: true, kind: 'a report' }).ok, false);
    });
});
