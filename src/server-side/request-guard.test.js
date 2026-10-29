'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createRequestGuard, hostnameOf } = require('./request-guard');

/** Runs the middleware on a request with these headers; what it answered. */
function call(guard, headers, method = 'GET') {
    const sent = { status: 200, headers: {}, body: null, next: false };
    const res = {
        status(code) { sent.status = code; return this; },
        json(body) { sent.body = body; return this; },
        sendStatus(code) { sent.status = code; return this; },
        setHeader(name, value) { sent.headers[name.toLowerCase()] = value; }
    };
    guard.middleware({ method, headers }, res, () => { sent.next = true; });
    return sent;
}

test('hostnameOf drops the port and an IPv6 address\'s brackets', () => {
    assert.equal(hostnameOf('127.0.0.1:3000'), '127.0.0.1');
    assert.equal(hostnameOf('[::1]:3000'), '::1');
    assert.equal(hostnameOf('Lab.Example.com'), 'lab.example.com');
    assert.equal(hostnameOf(undefined), '');
});

test('a request with no Origin from this machine goes through, with no CORS headers', () => {
    const sent = call(createRequestGuard({ host: '127.0.0.1' }), { host: '127.0.0.1:3000' });
    assert.equal(sent.next, true);
    assert.equal(sent.headers['access-control-allow-origin'], undefined);
});

test('a web page on another origin is refused, even a preflight', () => {
    const guard = createRequestGuard({ host: '127.0.0.1' });
    const post = call(guard, { host: '127.0.0.1:3000', origin: 'https://evil.example' }, 'POST');
    assert.equal(post.next, false);
    assert.equal(post.status, 403);
    assert.match(post.body.error, /A11Y_ALLOWED_ORIGINS/);
    const preflight = call(guard, { host: '127.0.0.1:3000', origin: 'https://evil.example' }, 'OPTIONS');
    assert.equal(preflight.status, 403);
    assert.equal(preflight.headers['access-control-allow-origin'], undefined);
});

test('a sandboxed frame or a file: page (Origin "null") is refused', () => {
    const sent = call(createRequestGuard(), { host: 'localhost:3000', origin: 'null' }, 'POST');
    assert.equal(sent.status, 403);
});

test('the lab\'s own pages and the browser extension are served', () => {
    const guard = createRequestGuard({ host: '127.0.0.1' });
    const own = call(guard, { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }, 'POST');
    assert.equal(own.next, true);
    for (const origin of ['chrome-extension://abcdefghijklmnop', 'moz-extension://0b1c2d3e-uuid']) {
        const sent = call(guard, { host: '127.0.0.1:3000', origin }, 'POST');
        assert.equal(sent.next, true, origin);
        assert.equal(sent.headers['access-control-allow-origin'], origin);
        assert.equal(sent.headers.vary, 'Origin');
    }
});

test('the same address on another port is another origin', () => {
    const sent = call(createRequestGuard(), { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:8080' }, 'POST');
    assert.equal(sent.status, 403);
});

test('origins in A11Y_ALLOWED_ORIGINS are served, with a preflight answered', () => {
    const guard = createRequestGuard({ allowedOrigins: 'https://dash.example.com/, https://other.example' });
    const preflight = call(guard, { host: 'localhost:3000', origin: 'https://dash.example.com' }, 'OPTIONS');
    assert.equal(preflight.status, 204);
    assert.equal(preflight.next, false);
    assert.equal(preflight.headers['access-control-allow-origin'], 'https://dash.example.com');
});

test('a name pointed at the server (DNS rebinding) is refused', () => {
    const guard = createRequestGuard({ host: '127.0.0.1' });
    const sent = call(guard, { host: 'rebind.attacker.example:3000', origin: 'http://rebind.attacker.example:3000' }, 'POST');
    assert.equal(sent.status, 403);
    assert.match(sent.body.error, /A11Y_ALLOWED_HOSTS/);
    assert.equal(call(guard, {}).status, 403);
});

test('loopback names, IP addresses and the listening HOST are served', () => {
    const guard = createRequestGuard({ host: 'lab.internal' });
    for (const host of ['localhost:3000', 'app.localhost:3000', '[::1]:3000', '192.168.1.20:3000', '10.0.0.5', 'lab.internal:3000']) {
        assert.equal(guard.hostAllowed(host), true, host);
    }
    assert.equal(guard.hostAllowed('elsewhere.example'), false);
});

test('listening on every address allows no name of its own', () => {
    const guard = createRequestGuard({ host: '0.0.0.0' });
    assert.equal(guard.hostAllowed('0.0.0.0:3000'), true); // an address, not a name
    assert.equal(guard.hostAllowed('lab.example.com'), false);
});

test('A11Y_ALLOWED_HOSTS adds names, and "*" allows any', () => {
    assert.equal(createRequestGuard({ allowedHosts: 'lab.example.com' }).hostAllowed('LAB.example.com:443'), true);
    assert.equal(createRequestGuard({ allowedHosts: '*' }).hostAllowed('anything.example'), true);
});
