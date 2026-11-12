'use strict';

// The extension's session: the scans made since it started, kept by the
// extension itself, so it needs no server. Scan pages, look at them, remove
// one, download them, open them in the lab: only the last needs the lab
// running, as the lab's pages are served by it.
//
// Kept in IndexedDB, which the popup and the devtools panel share (one
// origin, the extension's) and which outlives the popup, closed each time
// the page is clicked on the way to the next. Each scan with its pictures
// (data URLs) is a record of its own. A change made in one panel is said to
// the others on a BroadcastChannel.
//
// "Shared" is when the session was last downloaded or opened in the lab:
// the scans added since are the ones a new session would lose, and is asked
// about first.

(function (global) {
    const DB_NAME = 'surea11y-manual-runner';
    const DB_VERSION = 1;
    const SCANS = 'scans';
    const META = 'meta';
    const META_KEY = 'session';
    const CHANNEL = 'surea11y-session';

    function request(req) {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
        });
    }

    /** IndexedDB, as the session keeps its records. */
    function indexedDbBackend(idb = global.indexedDB) {
        let opening = null;
        const db = () => {
            if (!opening) {
                opening = new Promise((resolve, reject) => {
                    const req = idb.open(DB_NAME, DB_VERSION);
                    req.onupgradeneeded = () => {
                        const d = req.result;
                        if (!d.objectStoreNames.contains(SCANS)) d.createObjectStore(SCANS, { keyPath: 'scanId' });
                        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
                    };
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error || new Error('could not open the session store'));
                });
            }
            return opening;
        };
        const store = async (name, mode) => (await db()).transaction(name, mode).objectStore(name);
        const done = async (name, mode, fn) => {
            const tx = (await db()).transaction(name, mode);
            const result = fn(tx.objectStore(name));
            await new Promise((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
                tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
            });
            return result;
        };
        return {
            async all() { return request((await store(SCANS, 'readonly')).getAll()); },
            put: (record) => done(SCANS, 'readwrite', (s) => s.put(record)),
            remove: (scanId) => done(SCANS, 'readwrite', (s) => s.delete(scanId)),
            clear: () => done(SCANS, 'readwrite', (s) => s.clear()),
            async meta() { return (await request((await store(META, 'readonly')).get(META_KEY))) || null; },
            setMeta: (meta) => done(META, 'readwrite', (s) => s.put(meta, META_KEY))
        };
    }

    /** In memory, for tests and where IndexedDB is missing. */
    function memoryBackend() {
        const scans = new Map();
        let meta = null;
        const copy = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
        return {
            async all() { return [...scans.values()].map(copy); },
            async put(record) { scans.set(record.scanId, copy(record)); },
            async remove(scanId) { scans.delete(scanId); },
            async clear() { scans.clear(); },
            async meta() { return copy(meta); },
            async setMeta(m) { meta = copy(m); }
        };
    }

    /**
     * The session, over a backend. `now` gives the time (tests set it);
     * `channel` says a change to the other panels (a BroadcastChannel, or
     * null).
     */
    function createScanSession({ backend = null, now = () => Date.now(), channel } = {}) {
        const be = backend || (global.indexedDB ? indexedDbBackend() : memoryBackend());
        const ch = channel !== undefined ? channel
            : (typeof global.BroadcastChannel === 'function' ? new global.BroadcastChannel(CHANNEL) : null);
        const listeners = new Set();
        if (ch) ch.onmessage = () => listeners.forEach((fn) => { try { fn(); } catch {} });
        const changed = () => {
            try { if (ch) ch.postMessage({ type: 'changed' }); } catch {}
            listeners.forEach((fn) => { try { fn(); } catch {} });
        };

        async function meta() {
            const m = await be.meta();
            if (m && typeof m.startedAt === 'number') return m;
            const fresh = { startedAt: now(), sharedAt: null };
            await be.setMeta(fresh);
            return fresh;
        }

        return {
            /** The scans, in the order they were added: [{ scanId, addedAt, scan }]. */
            async list() {
                const all = await be.all();
                return all.filter((r) => r && r.scan).sort((a, b) => (a.addedAt - b.addedAt) || String(a.scanId).localeCompare(String(b.scanId)));
            },
            /** Adds a scan (its scanId names it); resolves to the session's size. */
            async add(scan) {
                if (!scan || typeof scan.scanId !== 'string' || !scan.scanId) throw new Error('a scan needs its scanId');
                await meta();
                await be.put({ scanId: scan.scanId, addedAt: now(), scan });
                changed();
                return (await be.all()).length;
            },
            async remove(scanId) {
                await be.remove(scanId);
                changed();
            },
            /** Empties the session and starts a new one. */
            async clear() {
                await be.clear();
                await be.setMeta({ startedAt: now(), sharedAt: null });
                changed();
            },
            /** Records that the session was downloaded or opened in the lab. */
            async markShared() {
                const m = await meta();
                await be.setMeta({ ...m, sharedAt: now() });
                changed();
            },
            /** How many scans were added since it was last shared (all, if never). */
            async unsharedCount() {
                const m = await meta();
                const since = typeof m.sharedAt === 'number' ? m.sharedAt : -Infinity;
                return (await be.all()).filter((r) => r && r.addedAt > since).length;
            },
            /** Calls `fn` when the session changes, here or in another panel. */
            onChange(fn) {
                listeners.add(fn);
                return () => listeners.delete(fn);
            }
        };
    }

    const api = { createScanSession, memoryBackend, indexedDbBackend, DB_NAME, CHANNEL };
    global.A11Y_SCAN_SESSION = api;
    if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
