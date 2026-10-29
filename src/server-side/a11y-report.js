const fs = require('fs');
const path = require('path');
const {AXE_REPORTS_ROOT} = require('./report-paths');
const {toSafeId} = require('./shared-utils');

function encodeImageToBase64(buffer) {
    if (!buffer) return null;
    const base64 = buffer.toString('base64');
    return `data:image/jpeg;base64,${base64}`;
}

/**
 * Save the axe-core results
 *
 * @param {import('axe-core').AxeResults} results
 * @param {{
 *   url: string,
 *   scenarioName?: string,
 *   actions?: any,
 *   screenshot?: Buffer | string
 * }} options
 * @returns {{
 *   json?: json,
 *   extraScreenshots: array
 * }}
 */
function saveAxeHtmlReport(reportModel, options = {}) {
    const {
        url,
        scenarioName,
        actions,
        extraScreenshots
    } = options;

    if (!url) {
        throw new Error('saveAxeHtmlReport requires a url option');
    }

    const parsed = new URL(url);

    const urlId = toSafeId((parsed.hostname || '') + (parsed.pathname || ''));
    const base = urlId || 'page';

    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-'); // FS safe timestamp

    const fileName = `accessibility-report-${base}-${ts}.html`;

    // For extra screenshots taken by "screenshot" actions
    const extraScreenshotPublic = []; // { fileName, name, publicUrl }

    // screenshots for the results in the UI
    if (Array.isArray(extraScreenshots) && extraScreenshots.length) {
        extraScreenshots.forEach((shot, index) => {
            try {
                const buf = shot && shot.buffer
                    ? shot.buffer
                    : shot; // allow passing bare buffers as well

                if (!buf) return;

                const baseName = path.basename(fileName, path.extname(fileName));

                let safeName = null;
                if (shot && typeof shot.name === 'string' && shot.name.trim()) {
                    safeName = shot.name
                        .trim()
                        .toLowerCase()
                        .replace(/[^a-z0-9\-]+/g, '-')
                        .replace(/^-+|-+$/g, '');
                }

                // Always include index to avoid collisions
                // Examples:
                //   base-screenshot-1.jpg
                //   base-screenshot-before-submit-2.jpg
                const suffixParts = ['-screenshot'];
                if (safeName && safeName.length > 0) {
                    suffixParts.push('-', safeName);
                }
                suffixParts.push('-', String(index + 1));

                const shotFileName = `${baseName}${suffixParts.join('')}.jpg`;
                const displayName = (shot && shot.name) || `Screenshot ${index + 1}`;

                const shotPublicUrl = encodeImageToBase64(buf);

                extraScreenshotPublic.push({
                    fileName: shotFileName,
                    name: displayName,
                    publicUrl: shotPublicUrl
                });
            } catch (err) {
                console.error('Failed to save extra screenshot next to report:', err);
            }
        });
    }

    const jsonPayload = {
        url,
        scenarioName: scenarioName || null,
        actions: actions || null,
        timestamp: now.toISOString(),

        // Keep runOnly as a convenience field if present
        runOnly: reportModel && reportModel.runOnly ? reportModel.runOnly : null,

        // Canonical-first export payload
        canonical: reportModel && reportModel.canonical ? reportModel.canonical : null,

        // Optional debug artifact
        native: reportModel && reportModel.native ? reportModel.native : null,
    };

    return {
        json: jsonPayload,
        extraScreenshots: extraScreenshotPublic
    };
}

module.exports = {
    saveAxeHtmlReport
};
