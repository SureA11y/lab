'use strict';

/**
 * A11Y_STEALTH: the browser presents itself as a desktop Chrome, for a site
 * of your own whose bot filter refuses headless Chrome. Off by default: the
 * browser says what it is.
 *
 * It was puppeteer-extra's stealth plugin, unmaintained, and the reason for
 * the lab's audit warnings (deepmerge's prototype poisoning, through its
 * user-preferences plugin). This is what the lab needs of it, and no more:
 *
 *  - the user agent without "Headless", with client hints to match
 *    (Sec-CH-UA, navigator.userAgentData), set on every page the browser
 *    opens, through the same CDP call Set language makes after it
 *    (page-language.js keeps what this sets);
 *  - in every document, before its own scripts: navigator.webdriver false
 *    (the launch flag --disable-blink-features=AutomationControlled already
 *    does that for the main world), a desktop Chrome's PDF plugins and
 *    mime types where headless has none, window.chrome as a desktop
 *    Chrome's, and a notifications permission that agrees with
 *    Notification.permission.
 */

/** Whether A11Y_STEALTH asks for it. */
function stealthOn(env = process.env) {
    return ['1', 'true', 'yes', 'on'].includes(String(env.A11Y_STEALTH || '').trim().toLowerCase());
}

/** A desktop Chrome's user agent, and the client hints that go with it, from the browser's own. */
function desktopIdentity(browserUserAgent) {
    const userAgent = String(browserUserAgent || '').replace(/HeadlessChrome/g, 'Chrome');
    const full = (/Chrome\/([\d.]+)/.exec(userAgent) || [])[1] || '120.0.0.0';
    const major = full.split('.')[0];
    const platform = /Windows/.test(userAgent) ? 'Windows' : (/Mac OS X/.test(userAgent) ? 'macOS' : 'Linux');
    const brands = [
        { brand: 'Chromium', version: major },
        { brand: 'Google Chrome', version: major },
        { brand: 'Not_A Brand', version: '24' },
    ];
    return {
        userAgent,
        platform: platform === 'Windows' ? 'Win32' : (platform === 'macOS' ? 'MacIntel' : 'Linux x86_64'),
        userAgentMetadata: {
            brands,
            fullVersionList: brands.map((b) => ({ brand: b.brand, version: b.brand === 'Not_A Brand' ? '24.0.0.0' : full })),
            fullVersion: full,
            platform,
            platformVersion: platform === 'Windows' ? '10.0.0' : (platform === 'macOS' ? '14.0.0' : '6.0.0'),
            architecture: 'x86',
            model: '',
            mobile: false,
            bitness: '64',
            wow64: false,
        },
    };
}

// Run in every document before its scripts. Self-contained: it is sent to
// the page as source.
function patchDocument() {
    const define = (obj, key, get) => {
        try { Object.defineProperty(obj, key, { get, configurable: true }); } catch { /* frozen */ }
    };
    define(Object.getPrototypeOf(navigator), 'webdriver', () => false);

    // A desktop Chrome lists its PDF viewer; headless lists nothing.
    if (!navigator.plugins || navigator.plugins.length === 0) {
        const mime = { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' };
        const names = ['PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer', 'Microsoft Edge PDF Viewer', 'WebKit built-in PDF'];
        const plugins = names.map((name) => ({ name, filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1, 0: mime }));
        const list = (items, key) => {
            const out = Object.create({
                item(i) { return items[i] || null; },
                namedItem(n) { return items.find((x) => x[key] === n) || null; },
                refresh() {},
            });
            items.forEach((x, i) => { out[i] = x; });
            Object.defineProperty(out, 'length', { value: items.length });
            return out;
        };
        define(Object.getPrototypeOf(navigator), 'plugins', () => list(plugins, 'name'));
        define(Object.getPrototypeOf(navigator), 'mimeTypes', () => list([{ ...mime, enabledPlugin: plugins[0] }], 'type'));
    }

    if (!window.chrome) {
        try {
            Object.defineProperty(window, 'chrome', {
                value: { app: { isInstalled: false }, runtime: {}, loadTimes() { return {}; }, csi() { return {}; } },
                configurable: true,
            });
        } catch { /* already there */ }
    }

    // Headless answers "denied" to Notification.permission and "prompt" to
    // the permissions API: a desktop Chrome agrees with itself.
    try {
        const query = navigator.permissions && navigator.permissions.query && navigator.permissions.query.bind(navigator.permissions);
        if (query && window.Notification) {
            navigator.permissions.query = (params) => (params && params.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission, onchange: null })
                : query(params));
        }
    } catch { /* frozen */ }
}

/** Gives one page the desktop identity. Never throws: a page that closes meanwhile is left. */
async function stealthPage(page, identity) {
    try {
        const session = await page.createCDPSession();
        await session.send('Network.setUserAgentOverride', identity);
        await session.send('Emulation.setUserAgentOverride', identity).catch(() => {});
        await page.evaluateOnNewDocument(patchDocument);
    } catch {
        // Closed, or a target that is not a page.
    }
}

const IDENTITIES = new WeakMap(); // browser -> Promise<identity>

function identityOf(browser) {
    if (!IDENTITIES.has(browser)) IDENTITIES.set(browser, browser.userAgent().then(desktopIdentity));
    return IDENTITIES.get(browser);
}

/**
 * Gives `page` the desktop identity before it is used: a page opened by the
 * run, awaited, so its first request already carries it.
 */
async function stealthPageNow(page) {
    await stealthPage(page, await identityOf(page.browser()));
}

/**
 * Gives every page `browser` opens, now and later, the desktop identity:
 * popups and pages opened by a page as well. Resolves once the pages it has
 * now have it.
 */
async function applyStealth(browser) {
    const identity = await identityOf(browser);
    browser.on('targetcreated', async (target) => {
        if (target.type() !== 'page') return;
        const page = await target.page().catch(() => null);
        if (page) await stealthPage(page, identity);
    });
    const pages = await browser.pages().catch(() => []);
    await Promise.all(pages.map((page) => stealthPage(page, identity)));
}

module.exports = { stealthOn, applyStealth, stealthPageNow, desktopIdentity, patchDocument };
