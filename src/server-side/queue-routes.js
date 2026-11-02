'use strict';

/**
 * HTTP side of the run queue. Kept out of server.js so the routes can be
 * tested against a queue without starting the whole server.
 *
 * Result files and batch.json are not served here: the queue writes them
 * under reports/, which server.js already serves at /reports/..., so each view
 * carries the links to them.
 */

const fs = require('fs');
const path = require('path');
const { streamDirectoryZip, streamFilesZip } = require('./queue-zip');
const { imagePathsInFile } = require('./batch-package');
const { configForBatch, isConfig } = require('../shared/batch-config.js');
const { redactMaskedFields } = require('./run-queue');
const files = require('./queue-files');

const DEFAULT_QUEUE_SUBDIR = 'batches';

/**
 * The queue's folder: `subdir` (A11Y_QUEUE_DIR) under the reports folder.
 * Anything that would land outside it - an absolute path, `..` - falls back to
 * the default, since files outside reports/ would get no download links.
 */
function resolveQueueBaseDir(reportsRoot, subdir, { warn = console.warn } = {}) {
    const fallback = path.join(reportsRoot, DEFAULT_QUEUE_SUBDIR);
    const value = typeof subdir === 'string' ? subdir.trim() : '';
    if (!value) return fallback;
    const resolved = path.resolve(reportsRoot, value);
    const rel = path.relative(reportsRoot, resolved);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        warn(`[run-queue] A11Y_QUEUE_DIR must be a folder inside ${reportsRoot}; using ${fallback}`);
        return fallback;
    }
    return resolved;
}

function publicBaseFor(reportsRoot, baseDir) {
    const rel = path.relative(reportsRoot, baseDir).split(path.sep).map(encodeURIComponent).join('/');
    return `/reports/${rel}`;
}

/** "Web-Banking-queue-<id>.zip" for a batch run under a scenario name, else "queue-<id>.zip". */
function zipNameFor(id, name) {
    return name ? `${files.fileStem(name)}-queue-${id}.zip` : `queue-${id}.zip`;
}

function registerQueueRoutes(app, queue, { reportsRoot, baseDir, logError = console.error } = {}) {
    const publicBase = publicBaseFor(reportsRoot, baseDir);

    function itemLinks(sessionId, item) {
        item.fileUrl = item.file ? `${publicBase}/${sessionId}/${encodeURIComponent(item.file)}` : null;
        // Its own package: its result and the pictures it names.
        item.zipUrl = item.file ? `/queue/sessions/${sessionId}/items/${encodeURIComponent(item.id)}/download.zip` : null;
        item.zipName = item.file ? `${files.fileStem(item.name)}.zip` : null;
        return item;
    }

    function withLinks(state) {
        for (const s of state.sessions) {
            s.manifestUrl = `${publicBase}/${s.id}/batch.json`;
            s.zipUrl = `/queue/sessions/${s.id}/download.zip`;
            s.zipName = zipNameFor(s.id, s.name);
            s.itemsUrl = `/queue/sessions/${s.id}/items`;
            for (const item of s.active || []) itemLinks(s.id, item);
        }
        return state;
    }

    function respond(res, fn) {
        try {
            res.json(fn());
        } catch (err) {
            const status = err && Number.isInteger(err.statusCode) ? err.statusCode : 500;
            if (status >= 500) logError('[run-queue]', err);
            res.status(status).json({ error: err && err.message ? err.message : 'Queue request failed' });
        }
    }

    // Each batch in summary: its runs come from its itemsUrl, a page at a time.
    app.get('/queue', (_req, res) => respond(res, () => withLinks(queue.getState({ items: false }))));

    // A batch's runs, a page at a time: ?offset=0&limit=100&status=failed,error.
    app.get('/queue/sessions/:sessionId/items', (req, res) => respond(res, () => {
        const page = queue.getItems(req.params.sessionId, {
            offset: req.query && req.query.offset,
            limit: req.query && req.query.limit,
            status: req.query && req.query.status,
        });
        for (const item of page.items) itemLinks(page.sessionId, item);
        return page;
    }));

    app.post('/queue/items', (req, res) => respond(res, () => queue.addItems(
        req.body && req.body.items,
        { name: req.body && req.body.name, config: req.body && req.body.config },
    )));

    app.post('/queue/settings', (req, res) => respond(res, () => ({
        concurrency: queue.setConcurrency(req.body && req.body.concurrency),
    })));

    // Watching one run in the run tab: same shape as /workflow-progress, plus
    // the saved file's URL once it has one.
    app.get('/queue/items/:itemId/progress', (req, res) => respond(res, () => {
        const progress = queue.getItemProgress(req.params.itemId, req.query && req.query.since);
        progress.fileUrl = progress.file ? `${publicBase}/${progress.sessionId}/${encodeURIComponent(progress.file)}` : null;
        return progress;
    }));

    app.post('/queue/items/:itemId/cancel', (req, res) => respond(res, () => ({
        status: queue.cancelItem(req.params.itemId),
    })));

    app.post('/queue/cancel', (_req, res) => respond(res, () => ({ cancelled: queue.cancelAll() })));

    app.get('/queue/sessions/:sessionId/masked-fields', (req, res) => respond(res, () => queue.getMaskedFields(req.params.sessionId)));

    // Masked values come in the body, are put into the runs held in memory,
    // and are never written: batch.json keeps the redacted workflow.
    app.post('/queue/sessions/:sessionId/resume', (req, res) => respond(res, () => (
        queue.resumeSession(req.params.sessionId, { values: req.body && req.body.values })
    )));

    // POST like the other actions: the server's CORS answer allows GET and POST.
    app.post('/queue/sessions/:sessionId/delete', (req, res) => respond(res, () => queue.deleteSession(req.params.sessionId)));

    app.get('/queue/sessions/:sessionId/download.zip', (req, res) => {
        const id = req.params.sessionId;
        const dir = queue.sessionDir(id);
        if (!dir) return res.status(404).json({ error: 'No such session' });
        const manifest = files.readManifest(dir);
        // A batch saved before its configuration was kept beside it gets one
        // rebuilt from batch.json, so the zip always sets the batch up again.
        const extra = [];
        if (manifest && !manifest.configFile) {
            const config = configForBatch(manifest);
            if (config) extra.push({ name: `${files.fileStem(manifest.name || 'batch')}${files.CONFIG_SUFFIX}`, text: JSON.stringify(config, null, 2) });
        }
        streamDirectoryZip(res, dir, zipNameFor(id, manifest && manifest.name), { logError, extra });
    });

    // One run as a report package: its result and the pictures it names in
    // the batch's images/ folder (batch-package.js). A result saved before
    // batches were packages has its pictures inline, or as links, and goes
    // alone.
    app.get('/queue/sessions/:sessionId/items/:itemId/download.zip', async (req, res) => {
        const dir = queue.sessionDir(req.params.sessionId);
        const manifest = dir ? files.readManifest(dir) : null;
        const item = manifest && manifest.items.find((i) => i.id === req.params.itemId);
        if (!item || !item.file || item.file !== path.basename(item.file)) return res.status(404).json({ error: 'No such result' });
        let pictures;
        try {
            pictures = await imagePathsInFile(path.join(dir, item.file));
        } catch {
            return res.status(404).json({ error: 'No such result' });
        }
        const present = pictures.filter((p) => fs.existsSync(path.join(dir, p)));
        // Its configuration, as a report downloaded from the app carries its own.
        const extra = isConfig(item.config)
            ? [{ name: `${files.fileStem(item.name)}${files.CONFIG_SUFFIX}`, text: JSON.stringify(redactMaskedFields(item.config), null, 2) }]
            : [];
        streamFilesZip(res, dir, [item.file, ...present], `${files.fileStem(item.name)}.zip`, { logError, extra });
    });
}

module.exports = { registerQueueRoutes, resolveQueueBaseDir, DEFAULT_QUEUE_SUBDIR };
