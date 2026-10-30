// A run's screenshots: their buttons and thumbnails, and the dialog that
// shows one larger. Moved out of a11y-ui.js; what it shares with the rest of
// the app it reaches through `app`.

import {escapeAttr, escapeHtml, jsonToBrowserLink} from './a11y-ui.utils.js';
import {screenshotAlt} from './stream-ui.js';
import {createRenderer} from './a11y-ui.rendering.js';

/**
 * app: accessors for what the rest of the app shares with this part
 * (getScanTagSuggestions, liveStreamDialog, moveScan, renameScan, results, scansDialog, screenshots, screenshotsDialog, summaryEl, toggleScanIncludedInReport, updateResults, updateScanTags).
 */
export function createScreenshotsUi(app) {
    function imgToBtn(src, alt, viewportRatio = 1) {
        if (!src) return null;
        const button = document.createElement('button');
        const img = document.createElement('img');
        // "Screenshot: Home", which names the button that opens it larger too.
        img.alt = screenshotAlt(alt);
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = src;
        const btnContent = document.createElement('span');
        btnContent.style.aspectRatio = viewportRatio;
        if (viewportRatio > 1) {
            btnContent.style.width = '100%';
            btnContent.style.height = 'auto';
        } else {
            btnContent.style.width = 'auto';
            btnContent.style.height = '100%';
        }
        button.appendChild(btnContent);
        btnContent.appendChild(img);
        button.classList.add('screenshot-btn');
        return button;
    }

    function buildScreenshotElements(scan) {
        const out = [];
        const scanLabel = scan?.label?.replace("Scan: ", "");

        if (scan && Array.isArray(scan.screenshots) && scan.screenshots.length) {
            scan.screenshots.forEach((s, i) => {
                let src = null;
                // A merged scan holds one screenshot per context, each named by
                // its context and with its own proportions (mobile, desktop).
                const context = scan.mergedScan === true && s && typeof s === 'object' && s.label ? String(s.label) : '';
                let alt = scanLabel ? scanLabel : (s && s.name ? s.name : `Screenshot ${i + 1}`);
                if (context) alt = `${alt} — ${context}`;
                if (typeof s === 'string') {
                    src = s;
                } else if (s) {
                    src = s.publicUrl || s.dataUrl || null;
                }
                const ratio = (context && Number.isFinite(s.viewportRatio)) ? s.viewportRatio : scan.viewportRatio;
                const btn = imgToBtn(src, alt, ratio || 1);
                if (!btn) return;
                btn.firstChild.style.aspectRatio = ratio;
                btn.onclick = () => app.scansDialog.openById(src);
                if (context) {
                    // Captioned with its context: seen, not read twice, as the
                    // image's alt already names it.
                    const figure = document.createElement('figure');
                    figure.className = 'screenshot-context-figure';
                    const caption = document.createElement('figcaption');
                    caption.setAttribute('aria-hidden', 'true');
                    caption.textContent = context;
                    figure.append(btn, caption);
                    out.push(figure);
                    return;
                }
                out.push(btn);
            });
            if (out.length) return out;
        }

        const report = scan && scan.report ? scan.report : null;
        if (report && typeof report === 'object') {
            const main =
                report.screenshotPublicUrl ||
                report.screenshotDataUrl ||
                (report.publicUrl ? report.publicUrl.replace(/\.html?$/i, '') + '-screenshot.jpg' : null);

            const mainBtn = imgToBtn(main, 'Main screenshot');
            mainBtn.onclick = () => app.scansDialog.openById(main);
            if (mainBtn) out.push(mainBtn);
        }

        return out;
    }

    const renderer = createRenderer({
        resultsEl: app.results,
        screenshotsEl: app.screenshots,
        escapeAttr,
        escapeHtml,
        jsonToBrowserLink,
        buildScreenshotElements,
        imgToBtn,
        dialogs: {scansDialog: app.scansDialog, screenshotsDialog: app.screenshotsDialog, liveStreamDialog: app.liveStreamDialog},
        onToggleScanIncludedInReport: app.toggleScanIncludedInReport,
        onMoveScan: app.moveScan,
        onRenameScan: app.renameScan,
        onEditScanTags: app.updateScanTags,
        getScanTagSuggestions: app.getScanTagSuggestions
    });

    function findSummaryScanNameEls(scanId) {
        const idSel = CSS.escape(scanId);
        return {
            text: app.summaryEl.querySelector(`.scan-name-text[data-scan-id="${idSel}"]`),
            input: app.summaryEl.querySelector(`.scan-name-input[data-scan-id="${idSel}"]`)
        };
    }

    function focusSummaryRenameBtn(scanId) {
        const btn = app.summaryEl.querySelector(`[data-scan-action="rename"][data-scan-id="${CSS.escape(scanId)}"]`);
        try {
            btn && btn.focus();
        } catch {
            // ignore
        }
    }

    function enterSummaryNameEdit(scanId) {
        const {text, input} = findSummaryScanNameEls(scanId);
        if (!text || !input) return;

        input.value = text.textContent;
        text.classList.add('visually-hidden');
        input.hidden = false;

        requestAnimationFrame(() => {
            try {
                input.focus();
                input.select();
            } catch {
                // ignore
            }
        });
    }

    function exitSummaryNameEdit(scanId) {
        const {text, input} = findSummaryScanNameEls(scanId);
        if (!input) return;

        input.hidden = true;
        if (text) text.classList.remove('visually-hidden');
    }

    function saveSummaryNameEdit(scanId) {
        const {input} = findSummaryScanNameEls(scanId);
        if (!input) return;

        const raw = String(input.value || '').trim();
        exitSummaryNameEdit(scanId);
        focusSummaryRenameBtn(scanId);
        app.renameScan(scanId, raw || null);
    }

    function cancelSummaryNameEdit(scanId) {
        exitSummaryNameEdit(scanId);
        focusSummaryRenameBtn(scanId);
    }

    app.summaryEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-scan-action]');
        if (!btn) return;

        const {scanAction, scanId} = btn.dataset;
        if (!scanId) return;

        if (scanAction === 'toggle') app.updateResults(btn, () => app.toggleScanIncludedInReport(scanId));
        else if (scanAction === 'move-up') app.moveScan(scanId, -1);
        else if (scanAction === 'move-down') app.moveScan(scanId, 1);
        else if (scanAction === 'rename') {
            e.preventDefault();
            enterSummaryNameEdit(scanId);
        }
    });

    app.summaryEl.addEventListener('keydown', (e) => {
        const input = e.target.closest('.scan-name-input');
        if (!input) return;

        const scanId = input.dataset.scanId;
        if (!scanId) return;

        if (e.key === 'Enter') {
            e.preventDefault();
            saveSummaryNameEdit(scanId);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelSummaryNameEdit(scanId);
        }
    });

    app.summaryEl.addEventListener('focusout', (e) => {
        const input = e.target.closest('.scan-name-input');
        if (!input || input.hidden) return;

        const scanId = input.dataset.scanId;
        if (!scanId) return;

        saveSummaryNameEdit(scanId);
    });

    return {
        get renderer() { return renderer; },
    };
}
