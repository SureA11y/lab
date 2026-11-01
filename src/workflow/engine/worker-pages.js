'use strict';

// The pages a loop or a crawl runs its items on at once: a new page of the
// same browser, set up as the run's page is (viewport, media, language).

const {applyLanguage, applyMediaConditions} = require('./emulation');

// What the runner sets up on every page before it loads (ctx.preparePage:
// core's hooks), for a page the workflow opens itself. Never fails the step.
async function prepareWorkerPage(ctx, workerPage) {
    if (typeof ctx?.preparePage !== 'function') return;
    try {
        await ctx.preparePage(workerPage);
    } catch {
    }
}

/** A new page in the context, in a window of its own where the browser can open one. */
async function newVisiblePage(context) {
    try {
        return await context.newPage({ type: 'window' });
    } catch {
        return context.newPage();
    }
}

async function createCrawlWorkerTarget(page, ctx, {isolation, inheritViewport} = {}) {
    const iso = (isolation === 'context') ? 'context' : 'page';
    const baseViewport = inheritViewport ? page.viewport?.() : null;

    if (iso === 'context') {
        const browser = page.browser();
        const workerContext = await browser.createBrowserContext();
        const workerPage = await workerContext.newPage();
        await prepareWorkerPage(ctx, workerPage);

        if (ctx?._visionDeficiency) {
            await workerPage.emulateVisionDeficiency(ctx._visionDeficiency).catch(() => {
            });
        }
        await applyMediaConditions(workerPage, ctx);
        await applyLanguage(workerPage, ctx);
        if (baseViewport?.width && baseViewport?.height) {
            await workerPage.setViewport(baseViewport).catch(() => {
            });
        }
        return {workerPage, workerContext, isolation: 'context'};
    }

    // In a window of its own, not a tab beside the run's: a background tab is
    // hidden, and Chrome runs no animation frame, mouse event or screenshot in
    // it, so every scan on it waited out its stage limit.
    const workerPage = await newVisiblePage(page.browserContext());
    await prepareWorkerPage(ctx, workerPage);
    if (ctx?._visionDeficiency) {
        await workerPage.emulateVisionDeficiency(ctx._visionDeficiency).catch(() => {
        });
    }
    await applyMediaConditions(workerPage, ctx);
    await applyLanguage(workerPage, ctx);
    if (baseViewport?.width && baseViewport?.height) {
        await workerPage.setViewport(baseViewport).catch(() => {
        });
    }
    return {workerPage, workerContext: null, isolation: 'page'};
}

module.exports = {
    createCrawlWorkerTarget
};
