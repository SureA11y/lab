'use strict';

// The keyboard step: a key name as the page knows it, and pressing a key or
// a combination of them.

const {isNonEmptyString} = require('./utils');

async function pressKey(page, key) {
    if (!isNonEmptyString(key)) return;

    if (key.includes('+')) {
        const parts = key.split('+').map(k => k.trim());
        const main = parts.pop();

        for (const mod of parts) {
            await page.keyboard.down(normalizeKey(mod));
        }

        await page.keyboard.press(normalizeKey(main));

        for (const mod of parts.reverse()) {
            await page.keyboard.up(normalizeKey(mod));
        }
    } else {
        await page.keyboard.press(normalizeKey(key));
    }
}

function normalizeKey(k) {
    const map = {
        ctrl: 'Control',
        control: 'Control',
        shift: 'Shift',
        alt: 'Alt',
        meta: 'Meta',
        cmd: 'Meta',
        command: 'Meta',
        esc: 'Escape',
        escape: 'Escape',
        enter: 'Enter',
        tab: 'Tab'
    };

    const key = k.trim();
    const lower = key.toLowerCase();
    return map[lower] || key;
}

module.exports = {
    normalizeKey,
    pressKey
};
