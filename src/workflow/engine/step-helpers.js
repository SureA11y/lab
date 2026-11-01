'use strict';

// Small helpers the steps share: the prefix of a nested step's path, how many
// pages a loop may use at once, the variants an evidence capture takes, and a
// name made safe for a file.

const {ACTION_DEFINITIONS} = require('../action-definitions');
const {toNumber} = require('./utils');

function formatActionPrefix(actionPathPrefix) {
    if (!Array.isArray(actionPathPrefix) || !actionPathPrefix.length) return '';
    const parts = actionPathPrefix.filter((n) => Number.isFinite(n) && n > 0);
    if (!parts.length) return '';
    return 'Action ' + parts.join('.') + ' ';
}

function normalizeEvidenceVariants(v) {
    const s = String(v || '').trim().toLowerCase();
    if (!s) return 'both';
    if (s === 'png' || s === 'mhtml' || s === 'both') return s;
    return 'both';
}

function safeFilenamePart(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    // keep it filesystem friendly
    return s
        .replace(/[\/\\?%*:|"<>]/g, '-')   // reserved
        .replace(/\s+/g, ' ')              // collapse spaces
        .trim()
        .slice(0, 210);
}

/**
 * How many workers forEachElement or a crawl runs: a whole number within
 * forEachElement's Concurrency field (1 to 8). Each worker is a page of its
 * own; 500 asked for opened 500.
 */
function clampConcurrency(value) {
    const {min, max} = ACTION_DEFINITIONS.forEachElement.fields.concurrency;
    return Math.min(max, Math.max(min, Math.floor(toNumber(value, 1)) || 1));
}

module.exports = {
    formatActionPrefix,
    clampConcurrency,
    normalizeEvidenceVariants,
    safeFilenamePart
};
