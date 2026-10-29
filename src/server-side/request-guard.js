'use strict';

/**
 * Who may call the server (server.js). It has no login and opens any page it
 * is given, so a web page must not be able to drive it from a visitor's
 * browser:
 *
 * - **Origin.** A browser names the page behind every cross-origin request,
 *   and behind every POST. Only the lab's own pages, the browser extension and
 *   the origins in A11Y_ALLOWED_ORIGINS are served; a request with no Origin
 *   (curl, a script, the CLI's integrations) is not from a web page and goes
 *   through.
 * - **Host.** A page on a name its owner points at 127.0.0.1 (DNS rebinding)
 *   is same-origin with the server as far as the browser knows, but it sends
 *   that name as Host. Only loopback names, IP addresses, the HOST the server
 *   listens on and the names in A11Y_ALLOWED_HOSTS are served.
 */

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1']);
const EXTENSION_PROTOCOLS = new Set(['chrome-extension:', 'moz-extension:', 'safari-web-extension:']);
const ANY_ADDRESS = new Set(['0.0.0.0', '::', '']);

/** A comma-separated list from the environment, trimmed and lowercased. */
function listFrom(value) {
    return String(value || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

/** The name in a Host header, without its port or an IPv6 address's brackets. */
function hostnameOf(hostHeader) {
    const host = String(hostHeader || '').trim().toLowerCase();
    if (host.startsWith('[')) {
        const end = host.indexOf(']');
        return end > 0 ? host.slice(1, end) : '';
    }
    const colon = host.indexOf(':');
    return colon >= 0 ? host.slice(0, colon) : host;
}

function isIpAddress(name) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || (name.includes(':') && /^[0-9a-f:.]+$/.test(name));
}

function createRequestGuard({ host = '', allowedHosts = '', allowedOrigins = '' } = {}) {
    const listenHost = String(host).trim().toLowerCase();
    const hosts = listFrom(allowedHosts);
    const origins = listFrom(allowedOrigins).map((o) => o.replace(/\/+$/, ''));
    const anyHost = hosts.includes('*');

    function hostAllowed(hostHeader) {
        const name = hostnameOf(hostHeader);
        if (!name) return false;
        if (anyHost || LOOPBACK_NAMES.has(name) || name.endsWith('.localhost') || isIpAddress(name)) return true;
        if (!ANY_ADDRESS.has(listenHost) && name === listenHost) return true;
        return hosts.includes(name);
    }

    function originAllowed(origin, hostHeader) {
        let url;
        try {
            url = new URL(origin);
        } catch {
            return false; // "null": a sandboxed frame, a file: page
        }
        if (EXTENSION_PROTOCOLS.has(url.protocol)) return true;
        if (url.host === String(hostHeader || '').trim().toLowerCase()) return true;
        return origins.includes(url.origin.toLowerCase());
    }

    function middleware(req, res, next) {
        if (!hostAllowed(req.headers.host)) {
            return res.status(403).json({
                ok: false,
                error: `Host "${hostnameOf(req.headers.host)}" is not allowed. To reach the lab by this name, add it to A11Y_ALLOWED_HOSTS (see SECURITY.md).`
            });
        }
        const origin = req.headers.origin;
        if (origin !== undefined) {
            if (!originAllowed(origin, req.headers.host)) {
                return res.status(403).json({
                    ok: false,
                    error: `Requests from ${origin} are not allowed. To call the lab from that page, add it to A11Y_ALLOWED_ORIGINS (see SECURITY.md).`
                });
            }
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        }
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
    }

    return { middleware, hostAllowed, originAllowed };
}

module.exports = { createRequestGuard, hostnameOf };
