'use strict';

/**
 * A picture a report names but that cannot be shown here says so, in place of
 * the browser's broken-image icon and an alt text describing a picture that
 * is not there: a report's JSON taken out of its package (report-package.js),
 * a link to a lab that no longer has the file, or one that is offline.
 *
 * One listener, on the page: an image's error event does not bubble, so it is
 * caught on its way down. A picture that is also a button (a screenshot that
 * opens full size) is replaced with its button, which would open nothing.
 */

/** Why the picture at `src` cannot be shown, as the end of a sentence. */
export function whyPictureMissing(src) {
    const s = String(src || '');
    if (/^images\//.test(s)) return 'it is not included with this copy of the report.';
    if (/^\/reports\//.test(s) || /^https?:\/\/[^/]+\/reports\//.test(s)) {
        return 'it was kept by the lab that ran the scan, which does not have it now.';
    }
    return 'it could not be loaded.';
}

export function watchForMissingPictures(root) {
    const doc = root.ownerDocument || root;
    root.addEventListener('error', (event) => {
        const img = event.target;
        if (!img || img.tagName !== 'IMG' || img.dataset.missingNoted) return;
        img.dataset.missingNoted = 'true';
        const note = doc.createElement('p');
        note.className = 'picture-missing';
        const strong = doc.createElement('strong');
        strong.textContent = 'No picture: ';
        // Which picture it was is said beside it already: its heading, or
        // the occurrence it belongs to.
        note.append(strong, whyPictureMissing(img.getAttribute('src')));
        const holder = img.closest('button, a') || img;
        holder.replaceWith(note);
    }, true);
}
