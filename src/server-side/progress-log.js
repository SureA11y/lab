'use strict';

/**
 * A run's progress log, as the run tab's live view reads it, at a size that
 * does not grow with the number of scans.
 *
 * The live view replays the log from the start: the log panel shows every
 * line and the step counter works out where the run is from every step event,
 * so the text entries are all kept (up to `maxEntries`). But "a11yScan ready"
 * and screenshot entries each carry a screenshot as a data URL, a few hundred
 * KB apiece, and a workflow with hundreds of scans would otherwise hold them
 * all, on top of the copy in the result being built. Only the latest
 * `keepScreenshots` keep their image; older entries keep their line and say
 * the image was dropped (`extra.screenshotDropped`). The saved result still
 * has every screenshot.
 *
 * Indexes are absolute: `nextIndex` keeps counting when old entries are
 * dropped, so a reader polling with `since` never re-reads or skips a line.
 */

const MAX_ENTRIES = 10000;
const KEEP_SCREENSHOTS = 8;

function imageOf(entry) {
    const extra = entry && entry.extra;
    return !!(extra && typeof extra === 'object' && typeof extra.dataUrl === 'string' && extra.dataUrl);
}

function withoutImage(entry) {
    const { dataUrl, ...rest } = entry.extra;
    return { ...entry, extra: { ...rest, screenshotDropped: true } };
}

function createProgressLog({ maxEntries = MAX_ENTRIES, keepScreenshots = KEEP_SCREENSHOTS } = {}) {
    const entries = [];
    let offset = 0; // absolute index of entries[0]
    const withImages = []; // absolute indexes of entries still holding an image, oldest first

    function push(entry) {
        if (!entry || typeof entry !== 'object') return;
        const at = offset + entries.length;
        entries.push(entry);

        if (imageOf(entry)) {
            withImages.push(at);
            while (withImages.length > keepScreenshots) {
                const old = withImages.shift() - offset;
                // Replaced, not edited: the runner may still hold the original.
                if (old >= 0 && entries[old]) entries[old] = withoutImage(entries[old]);
            }
        }

        if (entries.length > maxEntries) {
            const drop = entries.length - maxEntries;
            entries.splice(0, drop);
            offset += drop;
            while (withImages.length && withImages[0] < offset) withImages.shift();
        }
    }

    /** Entries from absolute index `since` on, and the index to ask for next. */
    function slice(since = 0) {
        const from = Number.isFinite(Number(since)) ? Math.max(0, Number(since)) : 0;
        const start = Math.max(0, from - offset);
        return { logs: entries.slice(start), nextIndex: offset + entries.length };
    }

    return {
        push,
        slice,
        get size() { return entries.length; },
        get nextIndex() { return offset + entries.length; },
    };
}

module.exports = { createProgressLog, MAX_ENTRIES, KEEP_SCREENSHOTS };
