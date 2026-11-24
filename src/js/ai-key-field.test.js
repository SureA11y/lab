'use strict';

// The "Claude API key" field (ai-key-field.js): sends the key once, keeps
// nothing in the page, says whether a key is set, and keeps its typing out of
// the configuration's listeners.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

let M;
before(async () => { M = await import(pathToFileURL(path.join(__dirname, 'ai-key-field.js')).href); });

function page() {
    const dom = new JSDOM(`<dialog id="d"><input type="password" id="run-ai-key">
        <button id="run-ai-key-set">Use this key</button><button id="run-ai-key-forget" hidden>Forget the key</button>
        <p id="run-ai-key-status"></p></dialog>`);
    return dom.window.document;
}

// A server that keeps a key, as runtime-key.js does, and records the calls.
function fakeServer({ refuse = null } = {}) {
    let key = null;
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
        calls.push({ url, method: init.method, body: init.body });
        if (refuse) return { ok: false, json: async () => ({ error: refuse }) };
        if (init.method === 'PUT') key = JSON.parse(init.body).key;
        if (init.method === 'DELETE') key = null;
        return { ok: true, json: async () => ({ set: !!key, source: key ? 'app' : null }) };
    };
    return { fetchImpl, calls, key: () => key };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the key field', () => {
    test('sends the key once, empties the field, says it is set and offers to forget it', async () => {
        const doc = page();
        const server = fakeServer();
        M.setupAiKeyField(doc, server.fetchImpl);
        await settle();
        assert.match(doc.getElementById('run-ai-key-status').textContent, /No key set/);

        doc.getElementById('run-ai-key').value = '  sk-test-0123456789  ';
        doc.getElementById('run-ai-key-set').click();
        await settle();
        assert.equal(server.key(), 'sk-test-0123456789');
        assert.deepEqual(server.calls.map((c) => c.method), ['GET', 'PUT']);
        assert.equal(doc.getElementById('run-ai-key').value, '', 'nothing kept in the page');
        assert.match(doc.getElementById('run-ai-key-status').textContent, /forgotten when the lab stops/);
        assert.equal(doc.getElementById('run-ai-key-forget').hidden, false);

        doc.getElementById('run-ai-key-forget').click();
        await settle();
        assert.equal(server.key(), null);
        assert.match(doc.getElementById('run-ai-key-status').textContent, /The key is forgotten/);
        assert.equal(doc.getElementById('run-ai-key-forget').hidden, true);
    });

    test('a refusal is said, and the key is not kept in the page either', async () => {
        const doc = page();
        const server = fakeServer({ refuse: 'The key can only be set from the lab running on this computer.' });
        M.setupAiKeyField(doc, server.fetchImpl);
        await settle();
        doc.getElementById('run-ai-key').value = 'sk-test-0123456789';
        doc.getElementById('run-ai-key-set').click();
        await settle();
        assert.match(doc.getElementById('run-ai-key-status').textContent, /only be set from the lab/);
        assert.equal(doc.getElementById('run-ai-key').value, '');
    });

    test('nothing is sent without a key, and typing does not reach the dialog', async () => {
        const doc = page();
        const server = fakeServer();
        let heard = 0;
        doc.getElementById('d').addEventListener('input', () => { heard++; });
        M.setupAiKeyField(doc, server.fetchImpl);
        await settle();
        doc.getElementById('run-ai-key').dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
        assert.equal(heard, 0);
        doc.getElementById('run-ai-key-set').click();
        await settle();
        assert.deepEqual(server.calls.map((c) => c.method), ['GET']);
        assert.match(doc.getElementById('run-ai-key-status').textContent, /Type or paste the key first/);
    });

    test('says where a key in use comes from', () => {
        assert.match(M.keyStatusText({ set: true, source: 'environment' }), /ANTHROPIC_API_KEY/);
        assert.match(M.keyStatusText({ set: false }), /No key set/);
    });
});
