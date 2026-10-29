'use strict';

// How a report and a comparison name the engine that ran: surea11y as its
// brand tag, any other engine as plain text.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let B;
let doc;
before(async () => {
    B = await import('./engine-brand.js');
    doc = await import('./comparison-document.js');
});

describe('engine-brand', () => {
    test('surea11y, in any of the forms its id reaches a report, is the brand tag with its version', () => {
        for (const engine of [{ id: 'surea11y' }, { id: '@surea11y' }, { name: 'surea11y' }]) {
            const html = B.engineHTML({ ...engine, version: '1.14.0' });
            assert.match(html, /^<a href="https:\/\/www\.npmjs\.com\/package\/@surea11y\/core" class="engine-brand" aria-label="surea11y core 1\.14\.0">/);
            assert.match(html, /<span class="engine-brand__version">1\.14\.0<\/span>/);
        }
        assert.match(B.engineHTML({ id: 'surea11y' }), /aria-label="surea11y core"/);
    });

    test('another engine is its name and version as text, escaped', () => {
        assert.equal(B.engineHTML({ id: 'x', name: 'A <b> engine', version: '2' }), 'A &lt;b&gt; engine 2');
        assert.equal(B.enginesHTML([{ name: 'one' }, { name: 'two', version: '1' }]), 'one, two 1');
        assert.equal(B.enginesHTML(null), '');
    });

    test('a comparison names its engines in its header, as a report does, and not on each report\'s card', () => {
        const engines = [{ name: 'surea11y', version: '1.14.0' }];
        const head = doc.mastheadHTML({ title: 'Shop', summary: '2 runs', framing: 'Runs over time', scopes: [], generatedAt: '2026-10-28T10:00:00Z', engines });
        assert.match(head, /<dt>Engine<\/dt><dd><a [^>]*class="engine-brand" aria-label="surea11y core 1\.14\.0"/);
        const two = doc.mastheadHTML({ title: 'Shop', summary: '2 runs', framing: 'Runs over time', scopes: [], generatedAt: '2026-10-28T10:00:00Z', engines: [...engines, { name: 'surea11y', version: '1.15.0' }] });
        assert.match(two, /<dt>Engines<\/dt>/);
        assert.doesNotMatch(doc.reportsStripHTML([{ label: 'v1', name: 'Shop', pages: 2, engines }]), /engine-brand/);
    });
});
