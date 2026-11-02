'use strict';

/**
 * A report as a package (docs/report-package.md): the zip "Download report"
 * writes holds the HTML report, its stylesheet, an images/ folder and the
 * report as JSON. The JSON names each picture by its path in the package,
 * "images/<hash>.<ext>", the very file the HTML shows, so the pictures are
 * stored once, stay files anyone can open or reuse, and the JSON needs no
 * server: the app loads the zip and gives each path the picture's bytes.
 *
 * Packing turns every picture a report holds or links to into such a path:
 * an inline data URL (a page screenshot), a link the lab serves (/reports/...,
 * an element screenshot) or one the app made from a package it loaded (blob:).
 * Unpacking turns them back into links the page can show.
 */

export const IMAGES_DIR = 'images/';

// What the app builds from a report's scans to show it, and a report does not
// keep (report-format.js, since version 3): every scan's findings again.
const DERIVED_KEYS = ['findings', 'a11yGlobalFindings'];

/** A report as its JSON file holds it: without what is built from its scans. */
export function storedReportJson(payload, space) {
    const stored = { ...payload };
    for (const key of DERIVED_KEYS) delete stored[key];
    return JSON.stringify(stored, null, space);
}

export const IMAGE_EXTENSION_BY_MIME_TYPE = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/avif': 'avif',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico'
};

const MIME_TYPE_BY_EXTENSION = {
    jpg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    avif: 'image/avif',
    ico: 'image/x-icon'
};

// A picture held or linked to, as a report's strings carry it.
const PICTURE_REF = /^(data:image\/|\/reports\/|blob:)/;

// A picture's path in a package, as the JSON in it names it.
const PACKAGE_PATH = /^images\/[A-Za-z0-9._-]+$/;

export async function createContentHash(bytes) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hashBuffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 20);
}

export function decodeBase64DataUrl(dataUrl) {
    const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
    if (!match) throw new Error('The supplied value is not a valid Base64 data URL.');
    const mimeType = match[1].toLowerCase();
    const binaryString = atob(match[2].replace(/\s/g, ''));
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i += 1) bytes[i] = binaryString.charCodeAt(i);
    return { mimeType, bytes };
}

/**
 * The package's pictures, each stored once by its content: add(bytes,
 * mimeType) writes it to images/ in `zip` the first time and gives its file
 * name, "<hash>.<ext>", or null for a type no picture has.
 */
export function createImageStore(zip) {
    const names = new Map();
    return {
        async add(bytes, mimeType) {
            const extension = IMAGE_EXTENSION_BY_MIME_TYPE[String(mimeType || '').toLowerCase()];
            if (!extension) return null;
            const name = `${await createContentHash(bytes)}.${extension}`;
            if (!names.has(name)) {
                names.set(name, true);
                zip.file(`${IMAGES_DIR}${name}`, bytes, { binary: true });
            }
            return name;
        },
        get size() {
            return names.size;
        },
    };
}

/**
 * The bytes and type of the picture `ref` names, or why there are none:
 * `{ bytes, mimeType }`, `{ notPicture: true }` for a link to something else
 * the lab serves (an HTML report), or `{ error }`.
 */
async function pictureOf(ref, fetchImpl) {
    if (ref.startsWith('data:')) {
        try {
            return decodeBase64DataUrl(ref);
        } catch (error) {
            return { error: String(error && error.message || error) };
        }
    }
    try {
        const res = await fetchImpl(ref);
        if (!res.ok) return { error: `${res.status} ${res.statusText}`.trim() };
        const mimeType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!mimeType.startsWith('image/')) return { notPicture: true };
        return { mimeType, bytes: new Uint8Array(await res.arrayBuffer()) };
    } catch (error) {
        return { error: String(error && error.message || error) };
    }
}

/**
 * Gives every picture `payload` holds or links to its path in the package,
 * adding the picture to `store`. `payload` is changed: pass a copy. A picture
 * that cannot be had (gone from the lab, say) keeps its link and is listed in
 * `missing`, so the caller can say so.
 */
export async function packPayloadImages(payload, store, { fetchImpl = (url) => fetch(url), onProgress = null } = {}) {
    const paths = new Map(); // ref -> its path, or null
    const missing = [];
    let done = 0;

    async function pathFor(ref) {
        if (!paths.has(ref)) {
            paths.set(ref, (async () => {
                const picture = await pictureOf(ref, fetchImpl);
                if (picture.notPicture) return null;
                if (picture.error) {
                    missing.push({ ref: ref.startsWith('data:') ? 'an inline picture' : ref, error: picture.error });
                    return null;
                }
                const name = await store.add(picture.bytes, picture.mimeType);
                done += 1;
                if (onProgress && (done === 1 || done % 25 === 0)) await onProgress(done);
                return name ? `${IMAGES_DIR}${name}` : null;
            })());
        }
        return paths.get(ref);
    }

    async function walk(node) {
        if (Array.isArray(node)) {
            for (let i = 0; i < node.length; i += 1) node[i] = await visit(node[i]);
        } else if (node && typeof node === 'object') {
            for (const key of Object.keys(node)) node[key] = await visit(node[key]);
        }
    }

    async function visit(value) {
        if (typeof value === 'string') {
            if (!PICTURE_REF.test(value)) return value;
            return (await pathFor(value)) || value;
        }
        if (value && typeof value === 'object') await walk(value);
        return value;
    }

    await walk(payload);
    return { payload, missing };
}

/**
 * Links the page can show for the pictures of a package `zip`, by their path
 * in it: "images/<name>" -> a blob: URL of its bytes.
 */
export async function imageUrlsFromZip(zip, { createUrl = (blob) => URL.createObjectURL(blob) } = {}) {
    const urls = new Map();
    const entries = Object.values(zip.files).filter((e) => !e.dir && PACKAGE_PATH.test(e.name));
    for (const entry of entries) {
        const extension = entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase();
        const type = MIME_TYPE_BY_EXTENSION[extension];
        if (!type) continue;
        const bytes = await entry.async('uint8array');
        urls.set(entry.name, createUrl(new Blob([bytes], { type })));
    }
    return urls;
}

/**
 * A report's JSON `text` from a queue batch the lab keeps (its folder is a
 * package): each picture's path made a link to it in that folder, `base`
 * ("/reports/batches/<id>/"), which the lab serves.
 */
export function rebaseImageRefs(text, base) {
    return String(text).replace(/"(images\/[A-Za-z0-9._-]+)"/g, (match, at) => JSON.stringify(base + at));
}

/** The folder of a file the lab serves at `url`, ending in "/". */
export function folderOf(url) {
    const s = String(url || '');
    return s.slice(0, s.lastIndexOf('/') + 1);
}

/**
 * A package's report JSON `text` with each picture's path made the link
 * `urls` has for it. Done on the text, before it is parsed: one pass, and the
 * app parses the report again from it when it loads it. A path with no
 * picture in the package is left as it is: the view says it is not included.
 */
export function resolveImageRefs(text, urls) {
    if (!urls || !urls.size) return text;
    return String(text).replace(/"(images\/[A-Za-z0-9._-]+)"/g, (match, at) => (urls.has(at) ? JSON.stringify(urls.get(at)) : match));
}
