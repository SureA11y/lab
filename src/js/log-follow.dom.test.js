'use strict';

// DOM tests for createLogFollow, under jsdom: new lines keep the log at its
// end only while the user is there; once they scroll up to read, new lines
// leave the scroll alone until they come back down to the last line. jsdom
// lays nothing out, so each line is given a height and the box its sizes.

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

const LINE = 20;
const BOX = 100;

let createLogFollow;
let win;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.requestAnimationFrame = win.requestAnimationFrame.bind(win);
    globalThis.cancelAnimationFrame = win.cancelAnimationFrame.bind(win);
    ({createLogFollow} = await import('./log-follow.js'));
});

const frame = () => new Promise((r) => win.requestAnimationFrame(() => r()));

// A box of BOX px showing lines of LINE px, with a scrollTop clamped as a
// browser clamps it and a scroll event a frame after it changes.
function makeLog() {
    const el = document.createElement('div');
    document.body.append(el);
    let top = 0;
    const max = () => Math.max(0, el.children.length * LINE - BOX);
    Object.defineProperty(el, 'clientHeight', {get: () => BOX});
    Object.defineProperty(el, 'scrollHeight', {get: () => Math.max(BOX, el.children.length * LINE)});
    Object.defineProperty(el, 'scrollTop', {
        get: () => top,
        set: (v) => {
            const next = Math.max(0, Math.min(max(), v));
            if (next === top) return;
            top = next;
            win.requestAnimationFrame(() => el.dispatchEvent(new win.Event('scroll')));
        }
    });
    el.getBoundingClientRect = () => ({top: 0, bottom: BOX});
    const add = (n = 1) => {
        for (let i = 0; i < n; i++) {
            const line = document.createElement('div');
            const index = el.children.length;
            line.getBoundingClientRect = () => ({top: index * LINE - top, bottom: (index + 1) * LINE - top});
            el.append(line);
            follow.lineAdded();
        }
    };
    const follow = createLogFollow(el);
    return {el, follow, add, max};
}

describe('createLogFollow', () => {
    test('new lines keep the log at its end', async () => {
        const {el, add, max} = makeLog();
        add(10);
        await frame();
        assert.equal(el.scrollTop, max());
        add(3);
        await frame();
        assert.equal(el.scrollTop, max());
    });

    test('the scroll event of its own scroll, after more lines came, does not stop it following', async () => {
        const {el, follow, add, max} = makeLog();
        add(10);
        await frame();
        // More lines before the scroll event of the scroll to the end arrives.
        add(5);
        await frame();
        await frame();
        assert.equal(follow.isFollowing(), true);
        assert.equal(el.scrollTop, max());
    });

    test('scrolled up to read, new lines leave the scroll where it is', async () => {
        const {el, follow, add} = makeLog();
        add(20);
        await frame();
        el.scrollTop = 40;
        await frame();
        assert.equal(follow.isFollowing(), false);
        add(10);
        await frame();
        await frame();
        assert.equal(el.scrollTop, 40);
    });

    test('scrolled up while lines stream, it stays where the user left it', async () => {
        const {el, follow, add} = makeLog();
        add(20);
        await frame();
        add(1);
        el.scrollTop = 100;
        add(1);
        await frame();
        await frame();
        assert.equal(follow.isFollowing(), false);
        assert.equal(el.scrollTop, 100);
    });

    test('back down to the last line, it follows again', async () => {
        const {el, follow, add, max} = makeLog();
        add(20);
        await frame();
        el.scrollTop = 40;
        await frame();
        add(5);
        await frame();
        el.scrollTop = max();
        await frame();
        assert.equal(follow.isFollowing(), true);
        add(5);
        await frame();
        assert.equal(el.scrollTop, max());
    });

    test('a line short of the end is not the end', async () => {
        const {el, follow, add, max} = makeLog();
        add(20);
        await frame();
        el.scrollTop = max() - LINE;
        await frame();
        assert.equal(follow.isFollowing(), false);
    });

    test('an emptied log follows again', async () => {
        const {el, follow, add} = makeLog();
        add(20);
        await frame();
        el.scrollTop = 0;
        await frame();
        assert.equal(follow.isFollowing(), false);
        el.innerHTML = '';
        follow.reset();
        assert.equal(follow.isFollowing(), true);
    });

    test('moved elsewhere while being read, it keeps the line at its top', async () => {
        const {el, follow, add} = makeLog();
        add(20);
        await frame();
        el.scrollTop = 60;
        await frame();
        follow.move(() => { el.scrollTop = 0; });
        assert.equal(el.scrollTop, 60);
        assert.equal(follow.isFollowing(), false);
    });

    test('moved elsewhere while following, it goes back to its end', async () => {
        const {el, follow, add, max} = makeLog();
        add(20);
        await frame();
        follow.move(() => { el.scrollTop = 0; });
        assert.equal(el.scrollTop, max());
        await frame();
        assert.equal(follow.isFollowing(), true);
    });
});
