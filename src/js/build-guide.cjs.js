'use strict';

/**
 * Builds the shareable copy of docs/unattended-scans.html.
 *
 * The page in docs/ links the brand fonts from src/fonts so it opens straight
 * from the repository and the fonts stay in one place. A hosted copy cannot
 * reach them, so this inlines each face and drops the document wrapper the host
 * supplies itself.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(PROJECT_ROOT, 'docs', 'unattended-scans.html');
const DEST = path.join(PROJECT_ROOT, 'docs', 'unattended-scans.artifact.html');

const FONT_URL = /url\('(\.\.\/src\/fonts\/[^']+)'\)/g;

function inlineFonts(html) {
    const seen = new Set();

    const out = html.replace(FONT_URL, (match, relative) => {
        const file = path.resolve(path.join(PROJECT_ROOT, 'docs'), relative);
        if (!fs.existsSync(file)) throw new Error(`Font not found: ${relative}`);
        seen.add(relative);
        return `url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')})`;
    });

    if (!seen.size) throw new Error('No font references found, has the page changed?');
    return { html: out, count: seen.size };
}

/** The host wraps the page itself, so ship the content without a second wrapper. */
function stripDocumentWrapper(html) {
    const title = /<title>([^<]*)<\/title>/.exec(html);
    if (!title) throw new Error('The page has no title');

    const body = /<body>([\s\S]*)<\/body>/.exec(html);
    if (!body) throw new Error('The page has no body');

    return `<title>${title[1]}</title>\n${body[1].trim()}\n`;
}

function build() {
    const source = fs.readFileSync(SOURCE, 'utf8');
    const { html, count } = inlineFonts(source);

    fs.writeFileSync(DEST, stripDocumentWrapper(html), 'utf8');

    const size = Math.round(fs.statSync(DEST).size / 1024);
    console.log(`✔ ${path.relative(PROJECT_ROOT, DEST)} (${count} fonts inlined, ${size} KB)`);
}

build();
