'use strict';

import {createSplitButton} from './a11y-ui.utils.js';
import {writeComparisonZip} from './comparison-bundle.js';
import {fillLazyBodiesInHtml} from './lazy-dialogs.js';
import {afterPaint} from './busy.js';
import {getActivity, isCancelError} from './activity.js';
import {createImageStore, decodeBase64DataUrl, packPayloadImages, storedReportJson} from './report-package.js';
import {comparisonDescription, comparisonDocumentHtml, reportDocumentHtml} from './viewer-documents.js';
import {loadProcedures, loadStandards, reportLocale} from './procedures.js';
import {buildManualChecklistHTML} from './manual-checklist.js';

async function loadTemplate() {
    const res = await fetch('./report/report-template.html');

    if (!res.ok) {
        throw new Error(
            `Could not load the report template: ${res.status} ${res.statusText}`
        );
    }

    return await res.text();
}

function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// An export under way lists its steps in the activity panel (activity.js),
// `task`: a large report takes a while. Each step is shown before the work it
// names, which holds the page meanwhile, and is where Cancel takes effect.
async function startStep(task, label) {
    if (!task) return null;
    task.throwIfCancelled();
    const step = task.step(label);
    await afterPaint();
    return step;
}

async function stepDetail(task, step, detail) {
    if (!task || !step) return;
    task.throwIfCancelled();
    step.update(detail);
    await afterPaint();
}

// What the step compressing a zip shows: its percent, by tens. Compressing
// cannot stop half-way; Cancel takes effect once it is done.
function compressProgress(step) {
    let shown = 0;
    return (percent) => {
        const tens = Math.floor(percent / 10) * 10;
        if (step && tens > shown) {
            shown = tens;
            step.update(`${tens}%`);
        }
    };
}

/**
 * Runs `work(task)` as an action in the activity panel titled `title`: it
 * ends done with "Downloaded <the file name work returns>", or as the work
 * ended it; an error ends it failed with `failure` and what went wrong.
 */
function runExport(title, failure, work) {
    return getActivity().run(title, async (task) => {
        try {
            const fileName = await work(task);
            if (!task.ended && fileName) task.done(`Downloaded ${fileName}`);
            return fileName;
        } catch (error) {
            if (isCancelError(error)) throw error;
            console.error(failure, error);
            task.fail(`${failure} ${error && error.message ? error.message : error}`);
            return null;
        }
    }, {cancellable: true, rethrow: false});
}

// Set by the app: null when the report on screen is drawn in full, or a
// promise of it, as a long one is drawn a few scans at a time.
let whenReportDrawn = null;

export function setWhenReportDrawn(fn) {
    whenReportDrawn = typeof fn === 'function' ? fn : null;
}

function getReportContent({ includeFilteredOut = false } = {}) {
    const resultsContainer = document
        .querySelector('#results-container')
        .cloneNode(true);

    const removeSelectors = [
        '.inline-actions',
        '.engine-name',
        '.scan-include-toggle',
        '.scan-move-controls',
        '.scan-header-controls',
        '.scan-name-input',
        '.scan-excluded-badge',
        '.scan-summary-controls',
        '.scan-summary-excluded',
        '.scan-excluded-from-report',
        '#hide-excluded-scans-btn',
        // The tag filter is a live control, never part of the exported report.
        '.scan-tag-filter',
        // And for the report metadata editors: the name, URL and date they were
        // set to are part of the line, but nothing in a static document can
        // change them.
        '.report-meta-edit',
        '.report-meta-editor',
        'td a[href*="dequeuniversity.com"]'
    ];

    // By default the export follows the current view: scans the tag filter has
    // hidden are dropped. "Export all" passes includeFilteredOut to keep them.
    if (!includeFilteredOut) {
        removeSelectors.push('.scan-filtered-out');
    }

    resultsContainer
        .querySelectorAll(removeSelectors.join(', '))
        .forEach((element) => element.remove());


    // The exported report ships in default (workflow) order whatever sort is
    // applied in the app; its own control still lets recipients re-sort.
    const sortModule = globalThis.A11Y_SCAN_SORT;
    if (sortModule) {
        const containers = new Set();
        resultsContainer.querySelectorAll('[data-sort-order]').forEach((card) => {
            if (card.parentElement) containers.add(card.parentElement);
        });
        containers.forEach((container) => sortModule.sortContainer(container, 'default'));
    }

    const sortSelect = resultsContainer.querySelector('#scan-sort-select');
    if (sortSelect) {
        Array.from(sortSelect.options).forEach((option) => {
            if (option.value === 'default') option.setAttribute('selected', '');
            else option.removeAttribute('selected');
        });
        sortSelect.value = 'default';
    }

    // Run diagnostics are useful while operating the app, but exported artifacts
    // should not include noisy transient details.
    resultsContainer
        .querySelectorAll('.run-diagnostics')
        .forEach((diagnosticsElement) => {
            const headings = Array.from(diagnosticsElement.querySelectorAll('h3'));

            headings.forEach((heading) => {
                const title = String(heading.textContent || '').trim().toLowerCase();
                const shouldRemoveSection =
                    title === 'console errors' || title.startsWith('bad responses');

                if (!shouldRemoveSection) {
                    return;
                }

                const list = heading.nextElementSibling;
                heading.remove();

                if (list && list.tagName === 'UL') {
                    list.remove();
                }
            });

            const issueCount = diagnosticsElement.querySelectorAll('ul li').length;

            if (issueCount === 0) {
                diagnosticsElement.remove();
                return;
            }

            const summaryElement = diagnosticsElement.querySelector('summary');

            if (summaryElement) {
                summaryElement.textContent = `Issues during run (${issueCount})`;
            }
        });

    // The app draws a "View details" dialog's occurrences when it is first
    // opened; the exported report is a static document, so it gets them all,
    // drawn straight into its text.
    const results = resultsContainer.querySelectorAll('#results *').length > 0
        ? fillLazyBodiesInHtml(
            resultsContainer.innerHTML.replaceAll('()', ''),
            (body) => body.replaceAll('()', '')
        )
        : '';

    const screenshotsContainer = document
        .querySelector('#screenshots-container')
        .cloneNode(true);

    const screenshots =
        screenshotsContainer.querySelectorAll('#screenshots *').length > 0
            ? screenshotsContainer.innerHTML
            : '';

    return {
        results,
        screenshots
    };
}

async function loadAsset(path) {
    const res = await fetch(path);

    if (!res.ok) {
        throw new Error(
            `Could not load asset "${path}": ${res.status} ${res.statusText}`
        );
    }

    return await res.text();
}

function safeBaseName(value) {
    return String(value ?? 'report')
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/\.+$/g, '')
        .trim() || 'report';
}

function getReportMetaFromUi() {
    const element = document.querySelector('.report-meta');

    if (!element) {
        return '';
    }

    // Taken as a copy so the live controls can be dropped without touching the
    // block the app is still showing - the same ones getReportContent removes,
    // since this markup ends up in a static document too.
    const meta = element.cloneNode(true);
    meta
        .querySelectorAll('.report-meta-edit, .report-meta-editor')
        .forEach((control) => control.remove());

    return meta.outerHTML;
}

/**
 * The name the open report goes by, read back off the metadata line.
 *
 * The row says which value it holds, and the value sits in a span of its own.
 * Both matter: the row is only there once the report has been named, and
 * reading the whole row instead would pick up its edit control - the hidden
 * wording that names the control, its field label, its buttons - and carry all
 * of it into the exported file name and title.
 *
 * @param {ParentNode} [root]
 * @returns {string}
 */
export function reportNameFromMeta(root = document) {
    const value = root.querySelector(
        '.report-meta [data-meta-field="reportName"] .report-meta-value'
    );

    return value ? value.textContent.trim() : '';
}

function getReportNameFromUi() {
    return reportNameFromMeta();
}

function getReportTitleFromUi() {
    const reportName = getReportNameFromUi();

    return reportName
        ? `${reportName} - Automatic accessibility report`
        : 'Automatic accessibility report';
}

async function buildReport({ includeFilteredOut = false, task = null } = {}) {
    const template = await loadTemplate();
    const css = await loadAsset('./report/report.min.css');
    const js = await loadAsset('./report/report.min.js');

    const stillDrawing = whenReportDrawn ? whenReportDrawn() : null;
    if (stillDrawing) {
        await startStep(task, 'Drawing the last scans');
        await stillDrawing;
    }
    await startStep(task, 'Copying the report');
    const content = getReportContent({ includeFilteredOut });

    // Pictures the lab serves (/reports/...) only load from the lab: taken
    // into the file, they travel with it (the zip then moves them to images/).
    const adding = await startStep(task, 'Adding the pictures');
    let added = 0;
    const onProgress = (done, total) => {
        added = total;
        return stepDetail(task, adding, `${done} of ${total}`);
    };
    const results = await inlineServedImages(content.results, { onProgress });
    const screenshots = await inlineServedImages(content.screenshots);
    adding?.done(added ? plural(added, 'picture') : 'none to add');

    const reportMeta = getReportMetaFromUi();
    const reportTitle = getReportTitleFromUi();

    return reportDocumentHtml({template, css, js, title: reportTitle, meta: reportMeta, results, screenshots});
}

/**
 * `html` with every <img> the lab serves from /reports/, or the app shows from
 * a loaded package (blob:), given as a data URL, so the exported report shows
 * it away from the lab. A picture that can't be fetched keeps its URL: the
 * report still exports.
 */
export async function inlineServedImages(html, { fetchImpl = (url) => fetch(url), onProgress = null } = {}) {
    if (!html || !(html.includes('/reports/') || html.includes('blob:'))) return html;

    const holder = document.createElement('template');
    holder.innerHTML = html;

    // Also those of a report loaded from a package: the app shows its
    // pictures from blob: links that only live in this page.
    const images = Array.from(holder.content.querySelectorAll('img[src^="/reports/"], img[src^="blob:"]'));
    if (images.length === 0) return html;

    const dataUrls = new Map();
    const total = new Set(images.map((img) => img.getAttribute('src'))).size;
    for (const img of images) {
        const src = img.getAttribute('src');
        if (!dataUrls.has(src)) {
            dataUrls.set(src, servedImageAsDataUrl(src, fetchImpl));
            // Every few dozen pictures, not each: a paint per picture would
            // slow the export down.
            if (onProgress && (dataUrls.size === 1 || dataUrls.size % 25 === 0)) await onProgress(dataUrls.size, total);
        }
        const dataUrl = await dataUrls.get(src);
        if (dataUrl) img.setAttribute('src', dataUrl);
    }

    return holder.innerHTML;
}

async function servedImageAsDataUrl(src, fetchImpl) {
    try {
        const res = await fetchImpl(src);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

        const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!type.startsWith('image/')) throw new Error(`not an image (${type || 'no type'})`);

        const bytes = new Uint8Array(await res.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return `data:${type};base64,${btoa(binary)}`;
    } catch (error) {
        console.warn(`The picture "${src}" stays a link in the exported report: ${error.message || error}`);
        return null;
    }
}

function getComparisonContent() {
    const mount = document.querySelector('#run-comparison');

    if (!mount) {
        return '';
    }

    // Only the rendered diff travels; the tab's live chrome (hint, mode toggle,
    // file loaders, status) stays behind, as it does for the report export.
    const diff = mount.querySelector('.cmp2');

    return diff ? diff.outerHTML : '';
}

// What the rendered comparison calls itself.
//
// Read from the document masthead rather than reassembled from the tab's chrome:
// the masthead is what travels into the file, so the file's <title>, its meta
// description and its filename all say the same thing the page does. It used to
// be scraped from a chip class that no longer exists, which is why every
// exported comparison was called "Accessibility comparison".
function getComparisonDoc() {
    const head = document.querySelector('#run-comparison .cmp2 .doc-head');
    if (!head) return null;

    return {
        title: (head.dataset.docTitle || '').trim(),
        summary: (head.dataset.docSummary || '').trim(),
        generatedAt: (head.dataset.docGenerated || '').trim(),
    };
}

function getComparisonNameFromUi() {
    const doc = getComparisonDoc();
    return doc ? doc.title : '';
}

// A name, and nothing else.
//
// The same name the page shows: what the reader typed, or what the reports call
// themselves, or the generic label when neither is known. The dates, the counts
// and the sources belong in the description and in the document itself; a
// browser tab, a bookmark and a window switcher only have room to say which
// comparison this is.
function getComparisonTitleFromUi() {
    const doc = getComparisonDoc();
    return (doc && doc.title) || 'Accessibility comparison';
}

function getComparisonDescriptionFromUi() {
    const doc = getComparisonDoc();
    return comparisonDescription(doc && doc.summary);
}

async function buildComparison() {
    const comparison = getComparisonContent();

    if (!comparison) {
        throw new Error('Load at least two reports before exporting the comparison.');
    }

    const template = await loadAsset('./report/comparison-template.html');
    // The base sheet carries the tokens, fonts and theme handling; the extracted
    // Compare-tab block carries the .cmp2 components built on top of them.
    const css = await loadAsset('./report/report.min.css');
    const comparisonCss = await loadAsset('./report/comparison.min.css');
    const js = await loadAsset('./report/report.min.js');

    return comparisonDocumentHtml({
        template, css, comparisonCss, js,
        title: getComparisonTitleFromUi(),
        description: getComparisonDescriptionFromUi(),
        comparison,
    });
}

// Name and date, so a folder of these can be told apart and sorted without
// opening any of them.
function comparisonFileBaseName() {
    const doc = getComparisonDoc();
    const stamp = doc && doc.generatedAt ? doc.generatedAt.slice(0, 10) : '';
    const base = getComparisonNameFromUi() || 'accessibility-comparison';
    return safeBaseName(stamp ? `${base} ${stamp}` : base);
}

/**
 * Downloads the Accessibility Conformance Report (VPAT 2.5, WCAG and EU) of a
 * report `payload` as one HTML file (shared/conformance-report.js): the
 * automated draft, and whatever a reviewer recorded in it. Returns its name.
 */
export async function downloadConformanceReport(payload) {
    await loadStandards();
    const model = globalThis.A11Y_CONFORMANCE_REPORT;
    const view = globalThis.A11Y_CONFORMANCE_REPORT_HTML;
    if (!model || !view) throw new Error('The conformance report modules are not loaded.');
    const acr = model.buildConformanceReport(payload);
    const fileName = `${safeBaseName(getReportNameFromUi() || acr.product.name)} - conformance report.html`;
    downloadBlob(new Blob([view.conformanceReportHTML(acr)], { type: 'text/html' }), fileName);
    return fileName;
}

/**
 * The same report as a Word document (.docx), for teams that edit and sign
 * it there (shared/conformance-report-docx.js). Returns its name.
 */
export async function downloadConformanceReportDocx(payload) {
    await loadStandards();
    const model = globalThis.A11Y_CONFORMANCE_REPORT;
    const docx = globalThis.A11Y_CONFORMANCE_REPORT_DOCX;
    if (!model || !docx || !globalThis.JSZip) throw new Error('The conformance report modules are not loaded.');
    const acr = model.buildConformanceReport(payload);
    const fileName = `${safeBaseName(getReportNameFromUi() || acr.product.name)} - conformance report.docx`;
    downloadBlob(await docx.conformanceReportDocx(acr, globalThis.JSZip), fileName);
    return fileName;
}

/**
 * The manual review checklist (manual-checklist.js): what the report leaves
 * for a person, criterion by criterion, with core's procedures. Returns its
 * name, or null when the server's core has no procedures.
 */
export async function downloadManualChecklist(payload) {
    await loadStandards();
    const model = globalThis.A11Y_CONFORMANCE_REPORT;
    if (!model) throw new Error('The conformance report modules are not loaded.');
    const acr = model.buildConformanceReport(payload);
    const ids = acr.tables.filter((t) => /^wcag-/.test(t.id)).flatMap((t) => t.rows.map((r) => r.id));
    const locale = reportLocale(payload);
    const procedures = await loadProcedures(ids, locale);
    if (!procedures) return null;
    // EN 301 549's own requirements, from its pack, where the server has it.
    const enIds = acr.tables.filter((t) => ['en-4', 'en-9', 'en-12', 'en-other'].includes(t.id)).flatMap((t) => t.rows.filter((r) => !r.wcag).map((r) => r.id));
    const enProcedures = await loadProcedures(enIds, locale, { standard: 'en301549', version: acr.target.en301549 });
    // Any other standard the scans checked against, by standard and version.
    const standardProcedures = {};
    for (const t of acr.tables.filter((tb) => tb.standard && tb.standard !== 'wcag' && tb.standard !== 'en301549' && tb.version)) {
        const loaded = await loadProcedures(t.rows.map((r) => r.id), locale, { standard: t.standard, version: t.version });
        if (!loaded) continue;
        standardProcedures[t.standard] = standardProcedures[t.standard] || {};
        standardProcedures[t.standard][t.version] = { ...(standardProcedures[t.standard][t.version] || {}), ...loaded };
    }
    const title = getReportNameFromUi() || acr.product.name;
    const html = buildManualChecklistHTML({
        acr, procedures, enProcedures, standardProcedures, review: payload && payload.conformanceReview, levelLabels: model.LEVEL_LABEL, lang: locale, title,
    });
    const fileName = `${safeBaseName(title)} - manual review checklist.html`;
    downloadBlob(new Blob([html], { type: 'text/html' }), fileName);
    return fileName;
}

function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = fileName;

    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
}

async function downloadComparisonAsSingleHtml(task) {
    await startStep(task, 'Building the comparison');
    const html = await buildComparison();
    const fileName = `${comparisonFileBaseName()}.html`;
    task?.throwIfCancelled();
    downloadBlob(new Blob([html], { type: 'text/html' }), fileName);
    return fileName;
}

// The same HTML, with the JSON of each compared report and comparison.json,
// which lets the Compare tab load the zip back as this comparison.
async function downloadComparisonWithReports(getSnapshot, task) {
    await startStep(task, 'Building the comparison');
    const html = await buildComparison();
    const baseName = comparisonFileBaseName();
    const snapshot = getSnapshot();
    let compressed = null;
    const blob = await writeComparisonZip(getJsZipConstructor(), {
        html,
        baseName,
        snapshot,
        onReport: (i, name) => startStep(task, `Adding report ${i + 1} of ${snapshot.reports.length}: ${name}`),
        onCompress: (percent) => {
            if (!compressed) compressed = compressProgress(task ? task.step('Compressing') : null);
            compressed(percent);
        },
    });
    task?.throwIfCancelled();
    downloadBlob(blob, `${baseName}.zip`);
    return `${baseName}.zip`;
}

/**
 * Download control for the Compare tab: the comparison as one self-contained
 * HTML file, or, from its menu, a zip with that file and the reports it
 * compares, which the Compare tab can load back. `getSnapshot` returns the
 * comparison controller's snapshot(). `onError` receives anything thrown so
 * the caller can surface it in the tab's own status region.
 *
 * Returns the control and setEnabled(), since there is nothing to download
 * until two reports are loaded.
 */
export function createDownloadComparisonBtn({ onError, getSnapshot } = {}) {
    const report = (error) => { if (typeof onError === 'function') onError(error); };
    let current = null;
    const failure = 'The comparison could not be downloaded.';
    const asTask = (title, work) => async () => {
        const fileName = await runExport(title, failure, async (task) => {
            current = task;
            try {
                return await work(task);
            } catch (error) {
                if (!isCancelError(error)) report(error);
                throw error;
            }
        });
        current = null;
        return fileName;
    };

    const element = createSplitButton({
        label: 'Download comparison',
        menuLabel: 'Other download formats',
        onBusyPress: () => current?.reveal(),
        onAction: asTask('Download comparison', (task) => downloadComparisonAsSingleHtml(task)),
        items: [
            {
                id: 'zip',
                label: 'Download with the reports (zip)',
                description: 'The comparison and the JSON of each report, to load again in Compare',
                onSelect: asTask('Download comparison with the reports', (task) => downloadComparisonWithReports(getSnapshot, task))
            }
        ]
    });

    function setEnabled(enabled) {
        element.querySelectorAll('.split-button__action, .split-button__chevron').forEach((button) => {
            button.disabled = !enabled;
        });
    }

    setEnabled(false);

    return { element, setEnabled };
}

function getJsZipConstructor() {
    if (typeof window.JSZip !== 'function') {
        throw new Error(
            'JSZip is not available. Ensure that ' +
            './report/jszip.min.js is loaded before this module.'
        );
    }

    return window.JSZip;
}

async function extractBase64Images(
    content,
    store,
    imagePathPrefix
) {
    const dataUrlPattern =
        /data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\r\n\t ]+/gi;

    const matches = [...content.matchAll(dataUrlPattern)];

    if (matches.length === 0) {
        return content;
    }

    const replacements = new Map();

    for (const match of matches) {
        const dataUrl = match[0];

        if (replacements.has(dataUrl)) {
            continue;
        }

        try {
            const {
                mimeType,
                bytes
            } = decodeBase64DataUrl(dataUrl);

            // Stored once by its content, under the name the report's JSON
            // uses for it too (report-package.js).
            const filename = await store.add(bytes, mimeType);

            if (!filename) {
                console.warn(
                    `Unsupported Base64 image MIME type: ${mimeType}`
                );

                continue;
            }

            replacements.set(
                dataUrl,
                `${imagePathPrefix}${filename}`
            );
        } catch (error) {
            console.warn(
                'A Base64 image could not be extracted.',
                error
            );
        }
    }

    // One pass over the content: a replaceAll per image went over the whole
    // report again for each of its hundreds of pictures.
    return content.replace(
        dataUrlPattern,
        (dataUrl) => replacements.get(dataUrl) ?? dataUrl
    );
}

function addStylesheetLink(documentNode, href) {
    const existingLink = Array.from(
        documentNode.querySelectorAll('link[rel~="stylesheet"]')
    ).find(
        (link) => link.getAttribute('href') === href
    );

    if (existingLink) {
        return;
    }

    const link = documentNode.createElement('link');

    link.rel = 'stylesheet';
    link.href = href;

    documentNode.head.append(link);
}

function serializeHtmlDocument(documentNode) {
    const doctype = documentNode.doctype
        ? `<!DOCTYPE ${documentNode.doctype.name}>\n`
        : '<!DOCTYPE html>\n';

    return `${doctype}${documentNode.documentElement.outerHTML}`;
}

/**
 * The report as a package (report-package.js): the HTML, its stylesheet, the
 * images/ folder and, given `reportJson` ({ payload, fileName }), the report
 * as JSON naming the same pictures by their path, so the zip loads back into
 * the app (Open report, Compare) with them.
 */
async function createReportZip(html, reportFileName, { reportJson = null, task = null } = {}) {
    const JSZipConstructor = getJsZipConstructor();
    const zip = new JSZipConstructor();
    const store = createImageStore(zip);

    const parser = new DOMParser();

    const reportDocument = parser.parseFromString(
        html,
        'text/html'
    );

    /*
     * Extract every <style> element and combine its contents into one
     * external stylesheet.
     */
    const styleElements = Array.from(
        reportDocument.querySelectorAll('style')
    );

    let css = styleElements
        .map((styleElement) => styleElement.textContent || '')
        .filter((cssContent) => cssContent.trim() !== '')
        .join('\n\n');

    styleElements.forEach((styleElement) => {
        styleElement.remove();
    });

    /*
     * Images referenced from styles/report.css need to use ../images/
     * because the CSS file is one directory below the report HTML file.
     */
    css = await extractBase64Images(
        css,
        store,
        '../images/'
    );

    /*
     * The stylesheet link goes in while the document is parsed: it carries
     * no image, so adding it before the images are extracted changes nothing,
     * and spares parsing the whole report a second time to add it after.
     */
    if (css.trim()) {
        addStylesheetLink(
            reportDocument,
            'styles/report.css'
        );

        zip.file(
            'styles/report.css',
            `${css.trim()}\n`
        );
    }

    /*
     * Serialize the HTML after removing the <style> elements, then extract
     * Base64 images that appear in src, srcset, inline styles, SVG, etc.
     */
    await startStep(task, 'Packing the pictures');
    let processedHtml = serializeHtmlDocument(
        reportDocument
    );

    processedHtml = await extractBase64Images(
        processedHtml,
        store,
        'images/'
    );

    zip.file(
        reportFileName,
        processedHtml
    );

    if (reportJson && reportJson.payload) {
        const adding = await startStep(task, 'Adding the report data');
        const { payload, missing } = await packPayloadImages(reportJson.payload, store, {
            onProgress: (done) => stepDetail(task, adding, `${done} pictures`),
        });
        adding?.done(`${plural(store.size, 'picture')} in the zip`);
        if (missing.length) {
            console.warn(`${missing.length} picture(s) could not be added to the report data`, missing);
            task?.step('Some pictures are missing').warn(`${missing.length} picture${missing.length === 1 ? '' : 's'} could not be had: the report keeps a link to ${missing.length === 1 ? 'it' : 'them'} (the browser console lists which)`);
        }
        zip.file(reportJson.fileName, storedReportJson(payload));
        // The configuration it ran, beside it, for "Load configuration".
        if (payload.config && payload.config.type === 'a11y-ui-src-config') {
            zip.file(reportJson.fileName.replace(/\.a11y-report\.json$/, '') + '.a11y-config.json', JSON.stringify(payload.config, null, 2));
        }
    }

    const onCompress = compressProgress(await startStep(task, 'Compressing'));
    return await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: {
            level: 6
        }
    // generateAsync yields between files, so the percent can be painted.
    }, (metadata) => onCompress(metadata.percent));
}

async function downloadReport({ includeFilteredOut = false, getReportPayload = null, task = null } = {}) {
    const reportName = getReportNameFromUi();

    const fileName = safeBaseName(
        reportName || 'accessibility-report'
    );

    const html = await buildReport({ includeFilteredOut, task });

    // The same scans as the HTML, as JSON: a copy, as packing changes it.
    const payload = getReportPayload ? getReportPayload({ includeFilteredOut }) : null;
    const zipBlob = await createReportZip(
        html,
        `${fileName}.html`,
        { reportJson: payload ? { payload, fileName: `${fileName}.a11y-report.json` } : null, task }
    );

    task?.throwIfCancelled();
    downloadBlob(zipBlob, `${fileName}.zip`);
    return `${fileName}.zip`;
}

// Above this, a single file with its pictures inline is slow for a browser
// to open, so it asks before saving it; the zip holds the same report.
export const LARGE_SINGLE_FILE_BYTES = 50 * 1024 * 1024;

/** The question asked before saving a single file of `bytes`, or null when it is small. */
export function largeSingleFileQuestion(bytes) {
    if (!(bytes > LARGE_SINGLE_FILE_BYTES)) return null;
    const mb = Math.round(bytes / (1024 * 1024));
    return `This single file is ${mb} MB, as its pictures are inside it, and browsers can be slow to open a file this large. `
        + 'The zip holds the same report, its pictures as files.';
}

/**
 * The report as one HTML file. One over 50 MB asks first, in the activity
 * panel: download it anyway, get the zip instead (`getZip`), or cancel.
 */
async function downloadReportAsSingleHtml({ includeFilteredOut = false, task = null, getZip = null } = {}) {
    const html = await buildReport({ includeFilteredOut, task });

    const blob = new Blob(
        [html],
        {
            type: 'text/html'
        }
    );

    const question = largeSingleFileQuestion(blob.size);
    if (question && task) {
        const choice = await task.ask(question, [
            { label: 'Download it anyway', value: 'file' },
            ...(getZip ? [{ label: 'Get the zip instead', value: 'zip' }] : []),
            { label: 'Cancel', value: null },
        ]);
        if (choice === 'zip') {
            task.done('Getting the zip instead.');
            await getZip();
            return null;
        }
        if (choice !== 'file') {
            task.cancel();
            return null;
        }
    }

    const reportName = getReportNameFromUi();

    const fileName = safeBaseName(
        reportName || 'accessibility-report'
    );

    task?.throwIfCancelled();
    downloadBlob(blob, `${fileName}.html`);
    return `${fileName}.html`;
}

/**
 * DS SplitButton (mode="extras"): one default action — download the zipped
 * report — with near-identical format variants tucked behind the chevron
 * menu, per components/core/SplitButton.prompt.md ("download report" beside
 * "download as a single file" is the component's own canonical example).
 *
 * The zip is the whole report: its HTML, its pictures and its JSON
 * (`getReportPayload`), which loads back into the app (report-package.js).
 * The single-file HTML variant is built in; pass `extraItems` for any other
 * format the caller wants listed alongside it. Each extra item is a fully
 * self-contained action — unlike the built-in single-file variant, its
 * `onSelect` is responsible for its own confirmation/naming flow.
 *
 * Each download is an action in the activity panel (activity.js), its steps
 * listed as it goes; pressing the button meanwhile shows it again.
 *
 * `onBeforeAction(formatId)` runs before the zip default or the built-in
 * single-file item fires; returning `false` aborts that action (used by the
 * caller to prompt for a report name and let the user cancel).
 */
export function createDownloadReportSplitButton({onBeforeAction, extraItems = [], getReportPayload = null} = {}) {
    let current = null;
    const failure = 'The report could not be made.';
    const named = (what) => {
        const name = getReportNameFromUi();
        return name ? `${what} "${name}"` : what;
    };
    const asTask = (what, work) => async () => {
        const before = current;
        const fileName = await runExport(named(what), failure, (task) => {
            current = task;
            return work(task);
        });
        current = before;
        return fileName;
    };
    const zip = (includeFilteredOut) => (task) => downloadReport({ includeFilteredOut, getReportPayload, task });

    return createSplitButton({
        label: 'Download report',
        menuLabel: 'Other download formats',
        onBusyPress: () => current?.reveal(),
        guard: onBeforeAction ? () => onBeforeAction('zip') : undefined,
        onAction: asTask('Download report', zip(false)),
        items: [
            {
                id: 'html',
                label: 'Download as a single file',
                description: 'One .html, styles and images inline',
                guard: onBeforeAction ? () => onBeforeAction('html') : undefined,
                onSelect: asTask('Download report as a single file', (task) => downloadReportAsSingleHtml({
                    task,
                    getZip: asTask('Download report', zip(false)),
                }))
            },
            {
                id: 'zip-all',
                label: 'Download all scans',
                description: 'Ignores the tag filter (includes hidden scans)',
                guard: onBeforeAction ? () => onBeforeAction('zip-all') : undefined,
                onSelect: asTask('Download report with all scans', zip(true))
            },
            ...extraItems
        ]
    });
}

/**
 * The two report-level actions that sit beside the download split button.
 *
 * Both are labelled with a bare verb: side by side, "Compare" and "Clear" read
 * as one row of things to do with the report on screen, and repeating "report"
 * on each of them only pads the row. What the verb applies to still has to
 * reach a screen reader with no row to read it from, so each takes the full
 * phrase as its accessible name - which keeps the visible word inside it, so a
 * voice-control user saying "clear" still hits the button.
 */
export function createCompareReportBtn({accessibleName = 'Compare this report with another'} = {}) {
    const compareReportBtn =
        document.createElement('button');

    compareReportBtn.type = 'button';
    compareReportBtn.textContent = 'Compare';
    compareReportBtn.setAttribute('aria-label', accessibleName);
    compareReportBtn.classList.add('secondary-button');

    return compareReportBtn;
}

export function createClearReportBtn({accessibleName = 'Clear report'} = {}) {
    const clearReportBtn =
        document.createElement('button');

    clearReportBtn.type = 'button';
    clearReportBtn.textContent = 'Clear';
    clearReportBtn.setAttribute('aria-label', accessibleName);
    clearReportBtn.classList.add('secondary-button');

    return clearReportBtn;
}