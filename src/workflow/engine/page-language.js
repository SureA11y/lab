'use strict';

/**
 * The language a page is shown in, as Set language asks: what the browser
 * tells a site about the person's languages, set in the three places a site
 * reads it.
 *
 *  - The Accept-Language request header, for a site that picks its language
 *    on the server. The stealth plugin sets it with the user agent
 *    (Network.setUserAgentOverride), which wins over an extra header, so it
 *    is set the same way. That call replaces the whole user agent, so the
 *    one the page already presents is repeated with its client hints
 *    (Sec-CH-UA, navigator.userAgentData): without them a bot filter sees a
 *    browser that contradicts itself.
 *  - navigator.language and navigator.languages, for a site that picks it in
 *    its scripts: the stealth plugin patches them in the page, so they are
 *    patched again, after it, before the page's own scripts run.
 *  - The locale dates and numbers are written in (Intl, toLocaleString).
 *
 * Each lasts as long as the page, across navigation, until changed again.
 * null puts back what the page had before the first change: the browser's
 * default, with the run's own Accept-Language header. A page that already loaded keeps the language it chose until it
 * loads again.
 */

const STATE = new WeakMap();    // page -> { session, scriptId, tag, defaults, identity }
const IDENTITY = new WeakMap(); // browser -> Promise<{ userAgent, metadata }>

/** The canonical form of a BCP 47 tag ("pt-br" is "pt-BR"), or null. */
function canonicalLanguageTag(tag) {
    const text = String(tag || '').trim();
    if (!text) return null;
    try {
        const [canonical] = Intl.getCanonicalLocales(text);
        return canonical || null;
    } catch {
        return null;
    }
}

/** The languages a browser set to `tag` lists: the tag, then its language alone. */
function acceptLanguages(tag) {
    const base = String(tag).split('-')[0];
    return base && base !== tag ? [tag, base] : [tag];
}

// The client hints the browser presents, read where it gives them: a secure
// page (https or localhost). The page being tested may be neither, so a
// blank page of the same browser context is given a localhost address,
// answered from here without any network.
async function readIdentity(page) {
    let probe = null;
    try {
        probe = await page.browserContext().newPage();
        await probe.setRequestInterception(true);
        probe.on('request', (req) => {
            req.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>.</title>' }).catch(() => {});
        });
        await probe.goto('http://localhost/', { waitUntil: 'domcontentloaded', timeout: 10000 });
        return await probe.evaluate(async () => {
            const d = navigator.userAgentData;
            const hi = d
                ? await d.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'fullVersionList', 'wow64'])
                : null;
            return {
                userAgent: navigator.userAgent,
                metadata: hi ? {
                    brands: hi.brands || [],
                    fullVersionList: hi.fullVersionList || [],
                    platform: hi.platform || '',
                    platformVersion: hi.platformVersion || '',
                    architecture: hi.architecture || '',
                    model: hi.model || '',
                    mobile: !!hi.mobile,
                    bitness: hi.bitness || '',
                    wow64: !!hi.wow64
                } : null
            };
        });
    } catch {
        return { userAgent: null, metadata: null };
    } finally {
        if (probe) await probe.close().catch(() => {});
    }
}

function browserIdentity(page) {
    const browser = page.browser();
    if (!IDENTITY.has(browser)) IDENTITY.set(browser, readIdentity(page));
    return IDENTITY.get(browser);
}

async function stateFor(page) {
    let st = STATE.get(page);
    if (st) return st;

    // What the page presents before the first change, to repeat and to put back.
    const own = await page.evaluate(() => ({
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        languages: Array.from(navigator.languages || [])
    }));
    const shared = await browserIdentity(page);
    const browserUserAgent = await page.browser().userAgent().catch(() => null);
    st = {
        session: await page.createCDPSession(),
        scriptId: null,
        tag: null,
        defaults: own.languages.length ? own.languages : ['en-US', 'en'],
        // Whether the page started with an override of its own (the stealth
        // plugin's, determinism.userAgent): without one, the language it
        // started in came from the browser and the run's Accept-Language
        // header, and clearing ours is what puts both back.
        overridden: own.userAgent !== browserUserAgent,
        identity: {
            userAgent: own.userAgent,
            platform: own.platform,
            // The hints belong to the browser's user agent: a page given
            // another one (determinism.userAgent) had none to keep.
            metadata: shared.userAgent === own.userAgent ? shared.metadata : null
        }
    };
    STATE.set(page, st);
    return st;
}

/**
 * Shows `page` in `tag` (a canonical BCP 47 tag), or with null in the
 * language it had before the first change.
 */
async function setPageLanguage(page, tag) {
    const st = await stateFor(page);
    const languages = tag ? acceptLanguages(tag) : st.defaults;

    if (!tag && !st.overridden) {
        await st.session.send('Network.setUserAgentOverride', { userAgent: '' });
    } else {
        await st.session.send('Network.setUserAgentOverride', {
            userAgent: st.identity.userAgent,
            platform: st.identity.platform,
            acceptLanguage: languages.join(','),
            ...(st.identity.metadata ? { userAgentMetadata: st.identity.metadata } : {})
        });
    }

    if (st.scriptId) {
        await page.removeScriptToEvaluateOnNewDocument(st.scriptId).catch(() => {});
        st.scriptId = null;
    }
    if (tag) {
        const { identifier } = await page.evaluateOnNewDocument((list) => {
            const frozen = Object.freeze(list.slice());
            Object.defineProperty(Navigator.prototype, 'language', { get: () => frozen[0], configurable: true });
            Object.defineProperty(Navigator.prototype, 'languages', { get: () => frozen, configurable: true });
        }, languages);
        st.scriptId = identifier;
    }

    await st.session.send('Emulation.setLocaleOverride', tag ? { locale: tag } : {});
    st.tag = tag || null;
}

/** The language Set language asked `page` for, or null for the browser's own. */
function pageLanguage(page) {
    return (page && STATE.get(page)?.tag) || null;
}

module.exports = {
    canonicalLanguageTag,
    acceptLanguages,
    setPageLanguage,
    pageLanguage
};
