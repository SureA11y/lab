'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {createEvidenceWriter} = require('./evidence-writer.js');

function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-writer-'));
    const baseDir = path.join(root, 'evidence', 'run-1');
    const safeDirPart = (v) => String(v || '').trim().replace(/[\/\\?%*:|"<>]/g, '-').slice(0, 120);
    const save = createEvidenceWriter({
        baseDir,
        safeDirPart,
        ensureDirSync: (d) => fs.mkdirSync(d, {recursive: true}),
        toPublicUrl: (p) => '/reports/' + path.relative(root, p).split(path.sep).join('/')
    });
    return {root, baseDir, save, cleanup: () => fs.rmSync(root, {recursive: true, force: true})};
}

test('a unique file never replaces one with the same name', async (t) => {
    const {baseDir, save, cleanup} = setup();
    t.after(cleanup);
    const a = await save({variant: 'png', data: Buffer.from('first'), filename: 'Evidence__ev-1-1.png', unique: true});
    const b = await save({variant: 'png', data: Buffer.from('second'), filename: 'Evidence__ev-1-1.png', unique: true});
    const c = await save({variant: 'png', data: Buffer.from('third'), filename: 'Evidence__ev-1-1.png', unique: true});
    assert.equal(path.basename(a.path), 'Evidence__ev-1-1.png');
    assert.equal(path.basename(b.path), 'Evidence__ev-1-1__2.png');
    assert.equal(path.basename(c.path), 'Evidence__ev-1-1__3.png');
    assert.equal(fs.readFileSync(a.path, 'utf8'), 'first');
    assert.equal(fs.readFileSync(b.path, 'utf8'), 'second');
    assert.equal(fs.readFileSync(c.path, 'utf8'), 'third');
    assert.equal(fs.readdirSync(baseDir).length, 3);
    assert.equal(b.publicUrl, '/reports/evidence/run-1/Evidence__ev-1-1__2.png');
});

test('writes in the same moment each keep their own file', async (t) => {
    const {baseDir, save, cleanup} = setup();
    t.after(cleanup);
    const saved = await Promise.all(
        Array.from({length: 12}, (_, i) =>
            save({variant: 'mhtml', data: `page ${i}`, filename: 'Evidence__ev-main-1.mhtml', unique: true}))
    );
    assert.equal(new Set(saved.map((s) => s.path)).size, 12);
    assert.equal(fs.readdirSync(baseDir).length, 12);
    const contents = saved.map((s) => fs.readFileSync(s.path, 'utf8')).sort();
    assert.deepEqual(contents, Array.from({length: 12}, (_, i) => `page ${i}`).sort());
});

test('a name with dots in it keeps its extension last', async (t) => {
    const {save, cleanup} = setup();
    t.after(cleanup);
    await save({variant: 'png', data: Buffer.from('a'), filename: 'Payments v1.2__ev-1-1.png', unique: true});
    const b = await save({variant: 'png', data: Buffer.from('b'), filename: 'Payments v1.2__ev-1-1.png', unique: true});
    assert.equal(path.basename(b.path), 'Payments v1.2__ev-1-1__2.png');
});

test('without unique a file is written over what is there, as element pictures are', async (t) => {
    const {baseDir, save, cleanup} = setup();
    t.after(cleanup);
    await save({variant: 'png', data: Buffer.from('one'), filename: 'element-abc.png', dir: 'elements-scan'});
    const again = await save({variant: 'png', data: Buffer.from('two'), filename: 'element-abc.png', dir: 'elements-scan'});
    assert.equal(fs.readdirSync(path.join(baseDir, 'elements-scan')).length, 1);
    assert.equal(fs.readFileSync(again.path, 'utf8'), 'two');
});

test('the folder comes from dir, cleaned, and the result says where the file is', async (t) => {
    const {baseDir, save, cleanup} = setup();
    t.after(cleanup);
    const r = await save({
        variant: 'png', data: Buffer.from('x'), filename: 'a.png', dir: 'Payments/Filter', url: 'https://example.org/', meta: {k: 1}, unique: true
    });
    assert.equal(path.dirname(r.path), path.join(baseDir, 'Payments-Filter'));
    assert.equal(r.bytes, 1);
    assert.equal(r.url, 'https://example.org/');
    assert.deepEqual(r.meta, {k: 1});
});

test('an MHTML file is written as text, and counts its bytes as UTF-8', async (t) => {
    const {save, cleanup} = setup();
    t.after(cleanup);
    const r = await save({variant: 'mhtml', data: 'é', filename: 'p.mhtml', unique: true});
    assert.equal(r.bytes, 2);
    assert.equal(fs.readFileSync(r.path, 'utf8'), 'é');
});
