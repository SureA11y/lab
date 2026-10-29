#!/usr/bin/env node
'use strict';

/**
 * A batch spec from a sitemap: one workflow, run on every page the sitemap
 * lists (or those matching a filter). The batch runs with the lab's runner,
 * or in the app's Batch section (paste its "rows").
 *
 *   node examples/integrations/sitemap-to-batch.js <sitemap.xml or its URL> <workflow.spec.json> \
 *     [--match /products/] [--limit 50] > pages.batch.json
 *   node src/cli/run-workflow.js pages.batch.json
 *
 * The workflow is any run spec: its steps run on each page in turn, which
 * becomes the batch's name and the page's row. Reads <loc> entries only; a
 * sitemap index (a sitemap of sitemaps) is read one level down.
 */

const fs = require('fs');

async function readText(where) {
    if (/^https?:\/\//.test(where)) {
        const res = await fetch(where);
        if (!res.ok) throw new Error(`${where}: ${res.status} ${res.statusText}`);
        return res.text();
    }
    return fs.readFileSync(where, 'utf8');
}

function locations(xml) {
    return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}

async function pageUrls(where) {
    const xml = await readText(where);
    const locs = locations(xml);
    if (!/<sitemapindex[\s>]/.test(xml)) return locs;
    const pages = [];
    for (const sitemap of locs) pages.push(...locations(await readText(sitemap)));
    return pages;
}

/** "/products/shoes.html" -> "products/shoes.html", the row's name. */
function nameFor(url) {
    const { pathname } = new URL(url);
    return pathname.replace(/^\/+|\/+$/g, '') || 'home';
}

function batchSpec(urls, workflow, { name } = {}) {
    const seen = new Set();
    const rows = [];
    for (const url of urls) {
        let rowName = nameFor(url);
        for (let n = 2; seen.has(rowName); n += 1) rowName = `${nameFor(url)} (${n})`;
        seen.add(rowName);
        rows.push({ name: rowName, url });
    }
    const { $schema, ...spec } = workflow;
    return {
        type: 'a11y-batch-spec',
        specVersion: 1,
        name: name || workflow.scenarioName || 'Sitemap pages',
        spec,
        rows,
    };
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const option = (flag) => {
        const i = args.indexOf(flag);
        return i >= 0 ? args.splice(i, 2)[1] : null;
    };
    const match = option('--match');
    const limit = Number(option('--limit')) || Infinity;
    const [sitemap, workflowFile] = args;
    if (!sitemap || !workflowFile) {
        console.error('Usage: node examples/integrations/sitemap-to-batch.js <sitemap.xml or URL> <workflow.spec.json> [--match text] [--limit n]');
        process.exit(2);
    }
    pageUrls(sitemap)
        .then((urls) => {
            const chosen = urls.filter((u) => !match || u.includes(match)).slice(0, limit);
            if (!chosen.length) throw new Error('the sitemap lists no page to check');
            const workflow = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));
            process.stdout.write(JSON.stringify(batchSpec(chosen, workflow), null, 2) + '\n');
        })
        .catch((err) => {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        });
}

module.exports = { locations, pageUrls, batchSpec };
