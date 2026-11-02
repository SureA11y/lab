'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const { gzip } = require('./gzip');

async function serve(app) {
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

async function get(url, gz = true) {
    return new Promise((resolve, reject) => {
        http.get(url, { headers: gz ? { 'accept-encoding': 'gzip, deflate' } : {} }, (res) => {
            const parts = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(parts);
                const body = res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(raw) : raw;
                resolve({ headers: res.headers, raw, body: body.toString('utf8') });
            });
        }).on('error', reject);
    });
}

test('JSON and served files go compressed to a client that takes gzip, and as they are to one that does not', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gz-'));
    const report = JSON.stringify({ scans: Array.from({ length: 300 }, (_, i) => ({ rule: 'contrast-minimum', i })) });
    fs.writeFileSync(path.join(dir, 'r.json'), report);
    fs.writeFileSync(path.join(dir, 'p.png'), Buffer.alloc(5000, 1));
    const app = express();
    app.use(gzip());
    app.get('/big', (_req, res) => res.json(JSON.parse(report)));
    app.get('/small', (_req, res) => res.json({ ok: true }));
    app.use('/files', express.static(dir));
    const { base, close } = await serve(app);
    try {
        const big = await get(`${base}/big`);
        assert.equal(big.headers['content-encoding'], 'gzip');
        assert.ok(big.raw.length < report.length / 5);
        assert.deepEqual(JSON.parse(big.body), JSON.parse(report));

        const file = await get(`${base}/files/r.json`);
        assert.equal(file.headers['content-encoding'], 'gzip');
        assert.equal(file.body, report);

        assert.equal((await get(`${base}/small`)).headers['content-encoding'], undefined);
        assert.equal((await get(`${base}/files/p.png`)).headers['content-encoding'], undefined);
        const plain = await get(`${base}/big`, false);
        assert.equal(plain.headers['content-encoding'], undefined);
        assert.equal(plain.body, report);
    } finally {
        await close();
    }
});
