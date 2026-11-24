'use strict';

// A key given to the running lab (runtime-key.js): kept in memory, used before
// the environment's, never given back, and taken only from the lab's own page
// on this computer.

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const K = require('./runtime-key');
const { resolveProvider } = require('./provider');

const KEY = 'sk-test-0123456789abcdef';
afterEach(() => K.clearKey());

describe('the key', () => {
    test('is one word of printable signs, of a sensible length', () => {
        assert.equal(K.validKey(KEY), true);
        for (const bad of ['', 'short', 'has space in it', 'x'.repeat(401), 'tab\there1', 42, null]) assert.equal(K.validKey(bad), false, String(bad));
    });

    test('given to the app, it is used before the environment\'s, and forgetting it falls back', () => {
        const env = { ANTHROPIC_API_KEY: 'from-env-key' };
        assert.deepEqual(K.keyStatus(env), { set: true, source: 'environment' });
        assert.equal(K.setKey(KEY), true);
        assert.deepEqual(K.keyStatus(env), { set: true, source: 'app' });
        assert.equal(K.withRuntimeKey(env).ANTHROPIC_API_KEY, KEY);
        assert.equal(env.ANTHROPIC_API_KEY, 'from-env-key', 'the environment itself is left alone');
        assert.equal(resolveProvider(null, K.withRuntimeKey({})).name, 'anthropic');
        K.clearKey();
        assert.equal(K.withRuntimeKey(env).ANTHROPIC_API_KEY, 'from-env-key');
        assert.deepEqual(K.keyStatus({}), { set: false, source: null });
    });
});

describe('who may set it', () => {
    const req = (address, headers = {}) => ({ socket: { remoteAddress: address }, headers: { host: '127.0.0.1:3000', ...headers } });

    test('the lab\'s own page, or a script, on this computer', () => {
        assert.equal(K.fromLabPage(req('127.0.0.1', { origin: 'http://127.0.0.1:3000' })), true);
        assert.equal(K.fromLabPage(req('::1')), true);
        assert.equal(K.fromLabPage(req('::ffff:127.0.0.1', { origin: 'http://127.0.0.1:3000' })), true);
    });

    test('not another machine, another site, the extension or another port', () => {
        assert.equal(K.fromLabPage(req('192.168.1.20', { origin: 'http://127.0.0.1:3000' })), false);
        assert.equal(K.fromLabPage(req('172.17.0.1')), false);
        assert.equal(K.fromLabPage(req('127.0.0.1', { origin: 'https://evil.test' })), false);
        assert.equal(K.fromLabPage(req('127.0.0.1', { origin: 'chrome-extension://abcdef' })), false);
        assert.equal(K.fromLabPage(req('127.0.0.1', { origin: 'http://127.0.0.1:4000' })), false);
    });
});

describe('the routes', () => {
    async function serve() {
        const app = express();
        app.use(express.json());
        K.routes(app, { env: {} });
        const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const base = `http://127.0.0.1:${server.address().port}`;
        return { server, base };
    }

    test('set, ask and forget, never giving the key back, never cached', async () => {
        const { server, base } = await serve();
        try {
            const own = { origin: base, 'content-type': 'application/json' };
            let res = await fetch(base + '/api/ai/key', { headers: own });
            assert.deepEqual(await res.json(), { set: false, source: null });
            assert.equal(res.headers.get('cache-control'), 'no-store');

            res = await fetch(base + '/api/ai/key', { method: 'PUT', headers: own, body: JSON.stringify({ key: KEY }) });
            const text = await res.text();
            assert.equal(res.status, 200);
            assert.deepEqual(JSON.parse(text), { set: true, source: 'app' });
            assert.doesNotMatch(text, /sk-test/);

            res = await fetch(base + '/api/ai/key', { method: 'PUT', headers: own, body: JSON.stringify({ key: 'not a key' }) });
            assert.equal(res.status, 400);
            assert.equal((await res.json()).source, 'app', 'a bad key leaves the one set');

            res = await fetch(base + '/api/ai/key', { method: 'DELETE', headers: own });
            assert.deepEqual(await res.json(), { set: false, source: null });
        } finally {
            server.close();
        }
    });

    test('a page of another origin is refused and changes nothing', async () => {
        const { server, base } = await serve();
        try {
            const res = await fetch(base + '/api/ai/key', { method: 'PUT', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: JSON.stringify({ key: KEY }) });
            assert.equal(res.status, 403);
            assert.deepEqual(K.keyStatus({}), { set: false, source: null });
        } finally {
            server.close();
        }
    });
});
