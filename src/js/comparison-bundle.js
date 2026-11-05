// A comparison downloaded with the reports it compares, and loaded back.
//
// The zip holds the comparison as one HTML file, each report as the JSON the
// Compare tab loads, and comparison.json, which says how they were arranged:
// what the reports are (runs over time, versions, variants), the column order
// and the comparison's name, note and date. Loading the zip in the Compare tab
// puts all of that back, so a comparison can be passed on and picked up again
// rather than rebuilt by hand. Any other zip, such as a queue's "Download
// all", is read as the reports it holds.
//
// JSZip is passed in rather than read from the page, so the bundle can be
// written and read under Node as well.

import { createImageStore, imageUrlsFromZip, packPayloadImages, resolveImageRefs, storedReportJson } from './report-package.js';

export const MANIFEST_FILE = 'comparison.json';
export const MANIFEST_TYPE = 'a11y-comparison';
export const MANIFEST_VERSION = 1;

const CONTEXTS = new Set(['time', 'versions', 'variants']);
const ORDERS = new Set(['time', 'given']);

function safeName(value) {
    return String(value ?? '')
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/\.+$/g, '')
        .trim() || 'report';
}

/**
 * The file each report is written to, in column order: "reports/01 March.a11y-report.json".
 * The position keeps the files in column order in any file list, and keeps two
 * reports with the same name apart.
 */
export function reportFileNames(names) {
    const width = Math.max(2, String(names.length).length);
    return names.map((name, i) => {
        const stem = safeName(String(name || '').replace(/\.(a11y-report\.)?json$/i, ''));
        return `reports/${String(i + 1).padStart(width, '0')} ${stem}.a11y-report.json`;
    });
}

/**
 * comparison.json for a snapshot of the Compare tab:
 * { context, order, profilesOff, document: {title, note, generatedAt}, reports: [{name, report}] }
 * with the reports in column order.
 */
export function buildManifest(snapshot, files) {
    return {
        type: MANIFEST_TYPE,
        version: MANIFEST_VERSION,
        context: snapshot.context,
        order: snapshot.order ?? null,
        // The profiles turned off, when some are.
        ...(Array.isArray(snapshot.profilesOff) && snapshot.profilesOff.length ? { profilesOff: snapshot.profilesOff.map(String) } : {}),
        document: {
            title: snapshot.document?.title || '',
            note: snapshot.document?.note || '',
            generatedAt: snapshot.document?.generatedAt || null,
        },
        reports: snapshot.reports.map((entry, i) => ({ file: files[i], name: entry.name || null })),
    };
}

/** What a zip's comparison.json says, checked; throws saying what is wrong with it. */
export function readManifest(json) {
    if (!json || typeof json !== 'object' || json.type !== MANIFEST_TYPE) {
        throw new Error(`${MANIFEST_FILE} is not a comparison description`);
    }
    if (json.version !== MANIFEST_VERSION) {
        throw new Error(`${MANIFEST_FILE} is version ${json.version}, and this app reads version ${MANIFEST_VERSION}`);
    }
    if (!Array.isArray(json.reports) || !json.reports.length
        || json.reports.some((r) => !r || typeof r.file !== 'string')) {
        throw new Error(`${MANIFEST_FILE} lists no report files`);
    }
    const doc = json.document && typeof json.document === 'object' ? json.document : {};
    return {
        context: CONTEXTS.has(json.context) ? json.context : 'time',
        order: ORDERS.has(json.order) ? json.order : null,
        profilesOff: Array.isArray(json.profilesOff) ? json.profilesOff.filter((k) => typeof k === 'string') : [],
        document: {
            title: typeof doc.title === 'string' ? doc.title : '',
            note: typeof doc.note === 'string' ? doc.note : '',
            generatedAt: typeof doc.generatedAt === 'string' ? doc.generatedAt : null,
        },
        reports: json.reports.map((r) => ({ file: r.file, name: typeof r.name === 'string' ? r.name : null })),
    };
}

/**
 * The zip for a comparison: `${baseName}.html`, comparison.json and one JSON
 * per report. Returns the zip's Blob (or, under Node, whatever `type` asks for).
 *
 * The reports are packed as a report package's (report-package.js): their
 * pictures go into one images/ folder, each once, and the JSON names them by
 * path. A report loaded from a package shows its pictures from links that
 * only live in this page; saved as they were, they would load back broken.
 *
 * `onReport(index, name)` is awaited before each report is packed and
 * `onCompress(percent)` called as the zip is written, for the activity panel.
 */
export async function writeComparisonZip(JSZip, { html, baseName, snapshot, type = 'blob', fetchImpl, onReport = null, onCompress = null }) {
    const zip = new JSZip();
    const files = reportFileNames(snapshot.reports.map((e) => e.name));
    const store = createImageStore(zip);

    zip.file(`${baseName}.html`, html);
    zip.file(MANIFEST_FILE, JSON.stringify(buildManifest(snapshot, files), null, 2));
    for (let i = 0; i < snapshot.reports.length; i += 1) {
        if (onReport) await onReport(i, snapshot.reports[i].name);
        const copy = JSON.parse(JSON.stringify(snapshot.reports[i].report));
        const { payload } = await packPayloadImages(copy, store, fetchImpl ? { fetchImpl } : {});
        zip.file(files[i], storedReportJson(payload, 2));
    }

    return zip.generateAsync({ type, compression: 'DEFLATE', compressionOptions: { level: 6 } },
        onCompress ? (metadata) => onCompress(metadata.percent) : undefined);
}

const QUEUE_MANIFEST = 'batch.json';
const QUEUE_MANIFEST_TYPE = 'a11y-queue-session';

async function loadZip(JSZip, data) {
    try {
        return await JSZip.loadAsync(data);
    } catch {
        throw new Error('not a readable zip file');
    }
}

async function readComparison(zip, manifestEntry) {
    let manifestJson;
    try {
        manifestJson = JSON.parse(await manifestEntry.async('string'));
    } catch {
        throw new Error(`${MANIFEST_FILE} is not valid JSON`);
    }
    const manifest = readManifest(manifestJson);
    // Pictures the reports name by their path in the zip (report-package.js).
    const images = await imageUrlsFromZip(zip);

    const reports = [];
    for (const { file, name } of manifest.reports) {
        const entry = zip.file(file);
        if (!entry) throw new Error(`${file} is listed in ${MANIFEST_FILE} but missing from the zip`);
        let json;
        try {
            json = JSON.parse(resolveImageRefs(await entry.async('string'), images));
        } catch {
            throw new Error(`${file} is not valid JSON`);
        }
        reports.push({ file, name: name || file.replace(/^reports\//, ''), json });
    }

    return { ...manifest, reports };
}

/**
 * Reads a comparison zip back: the arrangement from comparison.json and each
 * report's parsed JSON, in column order. A zip without comparison.json is
 * refused, since nothing says how its files go together.
 */
export async function readComparisonZip(JSZip, data) {
    const zip = await loadZip(JSZip, data);
    const manifestEntry = zip.file(MANIFEST_FILE);
    if (!manifestEntry) {
        throw new Error(`not a downloaded comparison: it has no ${MANIFEST_FILE}`);
    }
    return readComparison(zip, manifestEntry);
}

function baseName(path) {
    return path.split('/').pop();
}

// Folders, macOS resource forks and dotfiles are not reports.
function isReportCandidate(entry) {
    if (entry.dir) return false;
    if (entry.name.split('/').some((part) => part === '__MACOSX' || part.startsWith('.'))) return false;
    // A configuration beside the reports (a report package, a batch) is not one.
    if (/\.a11y-config\.json$/i.test(entry.name)) return false;
    return /\.json$/i.test(entry.name);
}

/**
 * Reads any zip given to the Compare tab.
 *
 * A downloaded comparison (it has comparison.json) comes back as
 * { kind: 'comparison', ...what readComparisonZip returns }.
 *
 * Any other zip is a bag of reports: { kind: 'reports', files: [{ path, name,
 * text }], ordered, rows }, one entry per JSON file in it. A queue's "Download
 * all" zip also holds batch.json, which is not a report: it is left out, and
 * its runs give the order (`ordered`), with `rows` true when they came from
 * batch rows. Otherwise the files come in path order.
 */
export async function readCompareZip(JSZip, data) {
    const zip = await loadZip(JSZip, data);

    const manifestEntry = zip.file(MANIFEST_FILE);
    if (manifestEntry) return { kind: 'comparison', ...(await readComparison(zip, manifestEntry)) };

    let entries = Object.values(zip.files).filter(isReportCandidate);

    let order = null;
    let rows = false;
    const queueEntry = entries.find((e) => e.name === QUEUE_MANIFEST);
    if (queueEntry) {
        let queue = null;
        try {
            queue = JSON.parse(await queueEntry.async('string'));
        } catch {
            // Unreadable: then it is just a file, and loads (or fails) as one.
        }
        if (queue && queue.type === QUEUE_MANIFEST_TYPE && Array.isArray(queue.items)) {
            entries = entries.filter((e) => e !== queueEntry);
            order = queue.items.map((i) => i && i.file).filter((f) => typeof f === 'string');
            rows = queue.items.some((i) => i && Number.isInteger(i.row));
        }
    }

    if (!entries.length) throw new Error('it holds no JSON reports');

    entries.sort((a, b) => a.name.localeCompare(b.name));
    if (order) {
        const at = (e) => { const i = order.indexOf(e.name); return i === -1 ? order.length : i; };
        entries.sort((a, b) => at(a) - at(b));
    }

    // A report package's pictures (report-package.js): its JSON names each
    // by its path in the zip, which becomes a link to the picture's bytes.
    const images = await imageUrlsFromZip(zip);
    const files = [];
    for (const entry of entries) {
        files.push({ path: entry.name, name: baseName(entry.name), text: resolveImageRefs(await entry.async('string'), images) });
    }
    return { kind: 'reports', files, ordered: !!order, rows };
}
