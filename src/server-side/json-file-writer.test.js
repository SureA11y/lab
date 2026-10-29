'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeJsonFile } = require('./json-file-writer.js');

function tmpFile() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-writer-'));
    return path.join(dir, 'out.json');
}

test('writes exactly what JSON.stringify returns', async () => {
    const when = new Date('2026-10-12T10:00:00Z');
    const value = {
        a: 1, b: 'two "quoted" \n line', c: [1, undefined, () => 1, Symbol('s'), null, NaN, Infinity, -0],
        d: { skipped: undefined, fn() {}, nested: { deep: [{ x: true }, { y: false }] } },
        when,
        custom: { toJSON(key) { return { from: key }; } },
        unicode: 'ñ — 🙂',
        empty: { obj: {}, arr: [] },
        long: Array.from({ length: 600 }, (_, i) => ({ i, deep: { list: [i, String(i)] } })),
    };
    const file = tmpFile();
    const bytes = await writeJsonFile(file, value);
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text, JSON.stringify(value));
    assert.equal(bytes, Buffer.byteLength(text));
});

test('top-level primitives and arrays', async () => {
    for (const value of ['text', 42, true, null, [1, [2, [3]]]]) {
        const file = tmpFile();
        await writeJsonFile(file, value);
        assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(value));
    }
});

test('refuses circular structures and values with no JSON form', async () => {
    const a = { list: [] };
    a.list.push({ back: a });
    await assert.rejects(writeJsonFile(tmpFile(), a), /circular/i);
    await assert.rejects(writeJsonFile(tmpFile(), undefined), /no JSON form/);
});

test('reports a write failure', async () => {
    await assert.rejects(writeJsonFile(path.join(os.tmpdir(), 'no-such-dir-xyz', 'out.json'), { a: 1 }));
});

test('writes a result larger than a JS string can hold, in many pieces', { skip: !process.env.JSON_WRITER_BIG && 'set JSON_WRITER_BIG=1 (needs ~2 GB of memory)' }, async () => {
    const shot = 'data:image/jpeg;base64,' + 'A'.repeat(1_500_000);
    const value = { scans: Array.from({ length: 400 }, (_, i) => ({ id: i, screenshot: shot })) };
    assert.throws(() => JSON.stringify(value), RangeError);
    const file = tmpFile();
    const bytes = await writeJsonFile(file, value);
    assert.ok(bytes > 600_000_000);
    assert.equal(fs.statSync(file).size, bytes);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
});
