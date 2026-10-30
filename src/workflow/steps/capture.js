'use strict';

// The steps that capture the page: a screenshot, an evidence capture (the
// page under several conditions), and an accessibility scan.

const {captureScreenshotArtifact} = require('../../server-side/screenshot-capture.js');
const {clearHoverStateForCapture, safeDoubleRAF, waitForOneDeep} = require('../engine/deep-query');
const {interpolateScanTags} = require('../engine/custom-steps');
const {interpolateVarTokensLoose} = require('../engine/vars');
const {isNonEmptyString, sleep, toBool, toNumber} = require('../engine/utils');
const {normalizeEvidenceVariants, safeFilenamePart} = require('../engine/step-helpers');
const {pushLog} = require('../engine/log');
const {waitForRenderSettle} = require('../engine/nav');

async function stepScreenshot(page, action, ctx, localVars) {
    if (ctx?.dryRun) {
        pushLog(ctx, 'info', 'Dry run: screenshot not taken');
        return;
    }
    const label = isNonEmptyString(action.label)
        ? interpolateVarTokensLoose(action.label.trim(), {localVars, ctx})
        : null;
    const preserveHover = toBool(action && action.preserveHover);

    // Deterministic ordering metadata for screenshot actions.
    // This uses the same per-iteration ordered counter as scans, so the UI can
    // interleave screenshots and scans in the "as-if concurrency = 1" order.
    if (typeof ctx._artifactCounter !== 'number') ctx._artifactCounter = 0;
    const _iterIdx =
        (typeof ctx._iterationIndex === 'number') ? ctx._iterationIndex :
            (ctx && ctx._iterVars && typeof ctx._iterVars.index === 'number') ? ctx._iterVars.index :
                null;
    const _artifactIdx = ctx._artifactCounter++;
    const _orderKey = `${_iterIdx !== null ? String(_iterIdx).padStart(6, '0') : 'main'}:${String(_artifactIdx).padStart(4, '0')}`;
    const _scanId = (_iterIdx !== null) ? `shot-${_iterIdx + 1}-${_artifactIdx + 1}` : `shot-main-${_artifactIdx + 1}`;

    const viewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight
    }));
    const viewportRatio = viewport.width / viewport.height;

    if (!preserveHover) await clearHoverStateForCapture(page);
    await waitForRenderSettle(page, 300);
    await safeDoubleRAF(page, 500);

    const wantFile = !!ctx?.saveScreenshotFile;

    // Timeout for screenshot capture, avoids rare hangs (especially under concurrency)
    const shotTimeoutMs = Math.max(
        1000,
        Number.isFinite(Number(action?.timeout)) ? Number(action.timeout) : 30000
    );

    const withShotTimeout = async (p, label) => {
        return await Promise.race([
            p,
            sleep(shotTimeoutMs).then(() => {
                throw new Error(`screenshot timeout (${shotTimeoutMs}ms) at ${label}`);
            })
        ]);
    };

    const shot = await withShotTimeout(
        captureScreenshotArtifact(page, {
            strategy: 'cdp',
            type: 'jpeg',
            quality: 80,
            output: {
                buffer: true,
                file: wantFile
            },
            // IMPORTANT: your captureScreenshotArtifact module expects saveFile({buffer, type, mimeType, bytes, suggestedName, meta})
            saveFile: wantFile ? async ({ buffer, bytes, type, mimeType, suggestedName, meta }) => {
                // ctx.saveScreenshotFile returns { filePath, publicUrl, bytes }
                return ctx.saveScreenshotFile({
                    data: buffer,
                    filename: suggestedName || `workflow-shot__${String(_orderKey).replace(/[:]/g, '-') }__${String(_scanId)}__${String(_artifactIdx).padStart(2, '0')}.jpg`,
                    dir: 'workflow',
                    meta: meta || { bytes, type, mimeType, kind: 'workflow-shot', orderKey: _orderKey, scanId: _scanId, iterationIndex: _iterIdx, artifactIndex: _artifactIdx }
                });
            } : null,
            suggestedName: `workflow-shot__${String(_orderKey).replace(/[:]/g, '-') }__${String(_scanId)}__${String(_artifactIdx).padStart(2, '0')}.jpg`,
            meta: { kind: 'workflow-shot', orderKey: _orderKey, scanId: _scanId, iterationIndex: _iterIdx, artifactIndex: _artifactIdx }
        }),
        'captureScreenshotArtifact'
    );
    const buffer = shot.buffer;
    let currentUrl = null;
    try {
        currentUrl = await ctx.race(page.url(), 'screenshot page.url');
    } catch {
    }
    if (ctx) {
        if (!Array.isArray(ctx.screenshots)) ctx.screenshots = [];
        ctx.screenshots.push({
            name: label,
            buffer,
            // expose normalized artifact metadata for mixed-mode (buffer/file/dataUrl)
            bytes: shot.bytes,
            type: shot.type,
            mimeType: shot.mimeType,
            dataUrl: shot.dataUrl || null,
            publicUrl: shot.publicUrl || null,
            filePath: shot.filePath || null,
            url: currentUrl,
            viewportRatio: shot.viewportRatio != null ? shot.viewportRatio : viewportRatio,
            // ordering metadata
            scanId: _scanId,
            orderKey: _orderKey,
            iterationIndex: _iterIdx,
            artifactIndex: _artifactIdx,
            // Only the page's top left: it was larger than a picture can be.
            ...(shot.clipped === true ? {clipped: true} : {})
        });
    }

    try {
        const dataUrl = 'data:image/jpeg;base64,' + Buffer.from(buffer).toString('base64');

        // Named after the step's label, as evidence captures are.
        const nameTemplate = isNonEmptyString(action?.label) ? action.label : 'Screenshot';

        const iter = (ctx && ctx._iterVars) ? ctx._iterVars : {};

        pushLog(ctx, 'screenshot', 'screenshot taken', {
            dataUrl,
            viewportRatio,
            url: currentUrl,
            nameTemplate,
            labelTemplate: label ?? null,

            // ordering metadata
            scanId: _scanId,
            orderKey: _orderKey,
            iterationIndex: _iterIdx,
            artifactIndex: _artifactIdx,

            name: action?.name ?? label,
            label: label ?? null,
            title: action?.title ?? null,

            action: {type: action?.type || 'screenshot', id: action?.id ?? null},

            index: (typeof iter.index === 'number') ? iter.index : null,
            oneBased: (typeof iter.index === 'number') ? (iter.index + 1) : null,
            total: (typeof iter.total === 'number') ? iter.total : null,

            varsGlobal: {...(ctx.vars || {})}
        });

    } catch {
    }
}

async function stepEvidenceCapture(page, action, ctx, localVars) {
    if (ctx?.dryRun) {
        pushLog(ctx, 'info', 'Dry run: evidence not captured');
        return;
    }
    await runEvidenceCaptureShared({ page, ctx, localVars, action });
}

async function stepA11yScan(page, action, ctx, localVars, depth, actionPathPrefix) {
    const fn = ctx && typeof ctx.handleA11yScanAction === 'function' ? ctx.handleA11yScanAction : null;
    const label = isNonEmptyString(action.label)
        ? interpolateVarTokensLoose(action.label.trim(), {localVars, ctx})
        : null;

    if (!fn) {
        // Keep a clear error, because silently ignoring hides bugs and differs by platform/run path.
        const msg = 'a11yScan action encountered but no ctx.handleA11yScanAction handler was provided by the runner';
        pushLog(ctx, 'error', msg, { actionType: action?.type ?? null, label: label });
        throw new Error(msg);
    }

    if(label) action.label = label;

    // "Wait for": the scan starts once this selector is on the page,
    // and visible unless the step says otherwise. Like the Wait for
    // selector step, one that never comes fails the step, rather than
    // scanning the page in a state the step did not ask for.
    const waitSel = isNonEmptyString(action.waitForSelector) ? action.waitForSelector.trim() : null;
    if (waitSel) {
        const waitTimeout = toNumber(action.waitTimeout, 10000);
        const h = await ctx.race(
            waitForOneDeep(page, waitSel, {visible: action.waitVisible !== false, timeout: waitTimeout}),
            `a11yScan waitForOneDeep ${waitSel}`
        );
        if (!h) throw new Error(`a11yScan: "${waitSel}" did not appear within ${waitTimeout} ms`);
        try { await h.dispose(); } catch {}
    }

    // Tags support the same token vocabulary as the label, so a single
    // templated tag (e.g. "{var:viewport}") fills in per iteration.
    if (Array.isArray(action.scanTags) || isNonEmptyString(action.scanTags)) {
        action.scanTags = interpolateScanTags(action.scanTags, {localVars, ctx});
    }

    await fn({ page, action, ctx, localVars, depth, actionPathPrefix });
}

async function runEvidenceCaptureShared({
                                            page,
                                            ctx,
                                            localVars,
                                            action,
                                            nameTemplateOverride = null,   // if provided, used for resolvedName
                                            labelOverride = undefined      // if provided, used for label (can be null)
                                        }) {
    const variants = normalizeEvidenceVariants(action?.evidenceVariant);
    const onError = (action && action.onError === 'fail') ? 'fail' : 'continue';
    const preserveHover = toBool(action && action.preserveHover);

    // Ensure persisted emulation is active for evidence capture (PNG screenshot + MHTML snapshot).
    // This keeps behavior consistent with screenshot/a11yScan after emulateVisionDeficiency.
    if (ctx?._visionDeficiency) {
        try {
            await page.emulateVisionDeficiency(ctx._visionDeficiency);
            // give it a frame to apply
            await waitForRenderSettle(page, 150);
            try {
                await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
            } catch {}
        } catch (e) {
            // evidence capture should not become flaky if emulation fails
            pushLog(ctx, 'warning', `evidenceCapture: failed to apply vision deficiency (${ctx._visionDeficiency}): ${String(e?.message || e)}`);
        }
    }

    // Runner must provide a writer, workflow-engine should not touch REPORTS_ROOT directly.
    const saveEvidenceFile =
        (ctx && typeof ctx.saveEvidenceFile === 'function')
            ? ctx.saveEvidenceFile
            : (ctx && ctx._rootCtx && typeof ctx._rootCtx.saveEvidenceFile === 'function')
                ? ctx._rootCtx.saveEvidenceFile
                : null;

    if (!saveEvidenceFile) {
        throw new Error('evidenceCapture requires ctx.saveEvidenceFile({ variant, data, filename, dir, url, meta })');
    }

    const dir = isNonEmptyString(action.dir)
        ? interpolateVarTokensLoose(action.dir.trim(), {localVars, ctx})
        : null;

    // label can be overridden by caller (a11yScan will do that)
    const label = (labelOverride !== undefined)
        ? labelOverride
        : (isNonEmptyString(action.label)
            ? interpolateVarTokensLoose(action.label.trim(), {localVars, ctx})
            : null);

    // The file is named after the step's label: `name` and `title`, which
    // older steps carried, are not declared and not read.
    const nameTemplate =
        isNonEmptyString(nameTemplateOverride) ? nameTemplateOverride :
            isNonEmptyString(action?.label) ? action.label :
                'Evidence';

    const resolvedName = safeFilenamePart(
        interpolateVarTokensLoose(String(nameTemplate), {localVars, ctx})
    ) || 'Evidence';

    // Optional readiness wait (same pattern as a11yScan)
    const wSel = isNonEmptyString(action.waitForSelector) ? action.waitForSelector.trim() : null;
    if (wSel) {
        const wVisible = action.waitVisible !== false;
        const wTimeout = toNumber(action.waitTimeout, toNumber(action.timeout, 15000));
        const __h = await ctx.race(
            waitForOneDeep(page, wSel, {visible: wVisible, timeout: wTimeout}),
            `evidenceCapture waitForSel ${wSel}`
        ).catch(() => null);
        try { if (__h) await __h.dispose(); } catch {}
    }

    if (!preserveHover) await clearHoverStateForCapture(page);
    await waitForRenderSettle(page, 300);
    await safeDoubleRAF(page, 500);

    let currentUrl = null;
    try {
        currentUrl = await ctx.race(page.url(), 'evidenceCapture page.url');
    } catch {}

    // ordering metadata, reuse the same artifact counter concept as screenshot/a11yScan
    if (typeof ctx._artifactCounter !== 'number') ctx._artifactCounter = 0;
    const _iterIdx =
        (typeof ctx._iterationIndex === 'number')
            ? ctx._iterationIndex
            : (ctx && ctx._iterVars && typeof ctx._iterVars.index === 'number')
                ? ctx._iterVars.index
                : null;

    // capture environment once (useful to reproduce evidence conditions)
    let env = {
        viewportWidth: null,
        viewportHeight: null,
        devicePixelRatio: null,
        userAgent: null
    };

    try {
        const v = await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
            dpr: window.devicePixelRatio || 1
        }));
        if (v && v.width && v.height) {
            env.viewportWidth = v.width;
            env.viewportHeight = v.height;
            env.devicePixelRatio = v.dpr;
        }
    } catch {}

    try {
        env.userAgent = await ctx.race(page.userAgent(), 'evidenceCapture page.userAgent');
    } catch {}

    let viewportRatio = null;
    if (env.viewportWidth && env.viewportHeight) {
        viewportRatio = env.viewportWidth / env.viewportHeight;
    }

    const fullPage = action.fullPage !== false; // default true
    const visionDeficiency = (ctx && ctx._visionDeficiency) ? ctx._visionDeficiency : null;

    const emitOne = async (variant) => {
        const _artifactIdx = ctx._artifactCounter++;
        const orderKey = `${_iterIdx !== null ? String(_iterIdx).padStart(6, '0') : 'main'}:${String(_artifactIdx).padStart(4, '0')}`;
        const scanId = (_iterIdx !== null)
            ? `ev-${_iterIdx + 1}-${_artifactIdx + 1}`
            : `ev-main-${_artifactIdx + 1}`;

        const ext = (variant === 'mhtml') ? 'mhtml' : 'png';
        const filename = `${resolvedName}__${scanId}.${ext}`;

        try {
            if (variant === 'png') {
                const shot = await captureScreenshotArtifact(page, {
                    strategy: 'chunked',
                    type: 'png',
                    maxChunkHeight: 15000,
                    overlap: 0
                });
                const buffer = shot.buffer;
                const bytes = shot.bytes;

                const saved = await saveEvidenceFile({
                    variant: 'png',
                    data: buffer,
                    filename,
                    dir,
                    url: currentUrl,
                    meta: {label, scanId, orderKey, iterationIndex: _iterIdx, artifactIndex: _artifactIdx, env, fullPage, visionDeficiency}
                });

                if (!Array.isArray(ctx.evidence)) ctx.evidence = [];
                ctx.evidence.push({
                    kind: 'evidence',
                    variant: 'png',
                    path: saved?.path ?? null,
                    publicUrl: saved?.publicUrl ?? null,
                    bytes: saved?.bytes ?? bytes,
                    url: currentUrl,
                    viewportRatio,
                    env,
                    fullPage,
                    visionDeficiency,
                    label,
                    name: resolvedName,
                    scanId,
                    orderKey,
                    iterationIndex: _iterIdx,
                    artifactIndex: _artifactIdx
                });

                pushLog(ctx, 'evidence', 'evidence saved (png)', {
                    variant: 'png',
                    path: saved?.path ?? null,
                    publicUrl: saved?.publicUrl ?? null,
                    bytes: saved?.bytes ?? bytes,
                    url: currentUrl,
                    viewportRatio,
                    env,
                    fullPage,
                    visionDeficiency,
                    label,
                    name: resolvedName,
                    scanId,
                    orderKey,
                    iterationIndex: _iterIdx,
                    artifactIndex: _artifactIdx
                });

                return;
            }

            // mhtml
            const session = await page.target().createCDPSession();
            let data = null;
            try {
                const res = await session.send('Page.captureSnapshot', {format: 'mhtml'});
                data = res && res.data ? String(res.data) : '';
            } finally {
                try { await session.detach(); } catch {}
            }

            const bytes = Buffer.byteLength(data || '', 'utf8');

            const saved = await saveEvidenceFile({
                variant: 'mhtml',
                data,
                filename,
                dir,
                url: currentUrl,
                meta: {label, scanId, orderKey, iterationIndex: _iterIdx, artifactIndex: _artifactIdx, env, fullPage, visionDeficiency}
            });

            if (!Array.isArray(ctx.evidence)) ctx.evidence = [];
            ctx.evidence.push({
                kind: 'evidence',
                variant: 'mhtml',
                path: saved?.path ?? null,
                publicUrl: saved?.publicUrl ?? null,
                bytes: saved?.bytes ?? bytes,
                url: currentUrl,
                env,
                fullPage,
                visionDeficiency,
                label,
                name: resolvedName,
                scanId,
                orderKey,
                iterationIndex: _iterIdx,
                artifactIndex: _artifactIdx
            });

            pushLog(ctx, 'evidence', 'evidence saved (mhtml)', {
                variant: 'mhtml',
                path: saved?.path ?? null,
                publicUrl: saved?.publicUrl ?? null,
                bytes: saved?.bytes ?? bytes,
                url: currentUrl,
                env,
                fullPage,
                visionDeficiency,
                label,
                name: resolvedName,
                scanId,
                orderKey,
                iterationIndex: _iterIdx,
                artifactIndex: _artifactIdx
            });
        } catch (e) {
            const errMsg = String(e?.message || e);

            // If strict, fail the workflow
            if (onError === 'fail') {
                throw e;
            }

            // Otherwise record an error artifact and continue
            if (!Array.isArray(ctx.evidence)) ctx.evidence = [];
            ctx.evidence.push({
                kind: 'evidence',
                variant,                 // 'png' or 'mhtml' requested
                path: null,
                bytes: null,
                url: currentUrl,
                viewportRatio: (variant === 'png') ? viewportRatio : undefined,
                env,
                fullPage,
                visionDeficiency,
                label,
                name: resolvedName,
                scanId,
                orderKey,
                iterationIndex: _iterIdx,
                artifactIndex: _artifactIdx,
                error: errMsg
            });

            pushLog(ctx, 'warning', `evidenceCapture: failed to save (${variant})`, {
                variant,
                filename,
                url: currentUrl,
                env,
                fullPage,
                visionDeficiency,
                label,
                name: resolvedName,
                scanId,
                orderKey,
                iterationIndex: _iterIdx,
                artifactIndex: _artifactIdx,
                error: errMsg
            });

            return;
        }
    };

    if (variants === 'both') {
        await emitOne('png');
        await emitOne('mhtml');
    } else {
        await emitOne(variants);
    }
}

const STEPS = {
    'screenshot': stepScreenshot,
    'evidenceCapture': stepEvidenceCapture,
    'a11yScan': stepA11yScan
};

module.exports = {STEPS, runEvidenceCaptureShared};
