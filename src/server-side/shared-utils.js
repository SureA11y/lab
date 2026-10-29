const crypto = require('crypto');

/**
 * Build a maximally robust safe identifier for filenames, directories, and DOM ids.
 * Includes:
 *  - Accent normalization
 *  - Underscore support
 *  - Hyphen replacement
 *  - Length enforcement
 *  - Deterministic short hash suffix for uniqueness
 *
 * @param {string} input
 * @param {number} maxLength  (default: 60 chars before hash)
 * @returns {string}
 */
function toSafeId(input, maxLength = 60) {
    const raw = String(input || '');

    // Normalize accents (NFKD splits diacritics)
    let id = raw
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '') // remove accents
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '-')    // keep a-z, 0-9, _
        .replace(/^-+|-+$/g, '');        // trim hyphens

    if (!id) id = 'item';

    // Enforce max length BEFORE adding hash
    if (id.length > maxLength) {
        id = id.slice(0, maxLength).replace(/-+$/g, '');
    }

    // Add deterministic short hash for uniqueness
    const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 6);

    return `${id}-${hash}`;
}

module.exports = {
    toSafeId
};
