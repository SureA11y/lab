'use strict';

// A Claude API key given to the running lab (the "Claude API key" field of Run
// settings), instead of ANTHROPIC_API_KEY in the server's environment. Kept in
// this process's memory only: never written to disk, a configuration, a
// report, a log or a reply, and gone when the server stops. A key given here
// is used before one in the environment.
//
// The routes (`routes`) take it only from the computer the server runs on,
// and only from the lab's own page: not from the browser extension, another
// allowed origin or another machine. What a page can learn is whether a key
// is set and where it came from, never the key.

let runtimeKey = null;

const MAX_LENGTH = 400;

/** Whether `value` can be a key: printable, no spaces, of a sensible length. */
function validKey(value) {
    return typeof value === 'string' && value.length >= 8 && value.length <= MAX_LENGTH && /^[\x21-\x7e]+$/.test(value);
}

function setKey(value) {
    if (!validKey(value)) return false;
    runtimeKey = value;
    return true;
}

function clearKey() {
    runtimeKey = null;
}

/** { set, source: 'app' | 'environment' | null }, the key never. */
function keyStatus(env = process.env) {
    if (runtimeKey) return { set: true, source: 'app' };
    if (env.ANTHROPIC_API_KEY) return { set: true, source: 'environment' };
    return { set: false, source: null };
}

/** The server's settings with a key given to the app in place of the environment's. */
function withRuntimeKey(env = process.env) {
    return runtimeKey ? { ...env, ANTHROPIC_API_KEY: runtimeKey } : env;
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Whether a request comes from this computer, and from the lab's own page when from a page. */
function fromLabPage(req) {
    const address = req.socket && req.socket.remoteAddress;
    if (!LOOPBACK_ADDRESSES.has(String(address || ''))) return false;
    const origin = req.headers && req.headers.origin;
    // No Origin: not a web page (a script on this computer).
    if (!origin) return true;
    const host = req.headers.host;
    return !!host && (origin === `http://${host}` || origin === `https://${host}`);
}

/** The routes, on an Express app: GET, PUT and DELETE /api/ai/key. */
function routes(app, { env = process.env } = {}) {
    const guard = (req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        if (!fromLabPage(req)) {
            res.status(403).json({ error: 'The key can only be set from the lab running on this computer. On a server, set ANTHROPIC_API_KEY in its environment.' });
            return;
        }
        next();
    };
    app.get('/api/ai/key', guard, (_req, res) => res.json(keyStatus(env)));
    app.put('/api/ai/key', guard, (req, res) => {
        const key = req.body && typeof req.body.key === 'string' ? req.body.key.trim() : '';
        if (!setKey(key)) {
            res.status(400).json({ error: 'That does not look like a key: it should be one word of letters, digits and signs, with no spaces.', ...keyStatus(env) });
            return;
        }
        res.json(keyStatus(env));
    });
    app.delete('/api/ai/key', guard, (_req, res) => {
        clearKey();
        res.json(keyStatus(env));
    });
}

module.exports = { setKey, clearKey, keyStatus, withRuntimeKey, validKey, fromLabPage, routes };
