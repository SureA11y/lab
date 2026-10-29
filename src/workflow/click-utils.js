'use strict';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms || 0)));
}

async function wait(page, ms) {
    if (page && typeof page.waitForTimeout === 'function') return page.waitForTimeout(ms);
    return sleep(ms);
}

async function isHandleGoneOrHidden(handle) {
    try {
        return await handle.evaluate(el => {
            if (!el) return true;
            if (!el.isConnected) return true;

            const cs = getComputedStyle(el);
            if (!cs) return true;

            const r = el.getBoundingClientRect();
            const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;

            return !visible;
        });
    } catch {
        // If we cannot evaluate, the context/handle is likely gone, treat as gone.
        return true;
    }
}

// How long the same element may sit still over the target before the retry
// gives up early. The retry is for things moving out of the way (a closing
// menu, a fading toast); an overlay that stays put, such as an open dialog,
// will not move however long it is waited for, so the caller's fallbacks are
// tried instead.
const STILL_COVERED_MS = 500;

async function clickViaMouseAtVerifiedPoint(page, elHandle, timeoutMs = 3000, mouseButton = 'left', clickCount = 1) {
    const started = Date.now();
    let coverKey = null;
    let coveredSince = 0;

    const cc = Math.max(1, Math.min(2, Number(clickCount) || 1));

    while ((Date.now() - started) < timeoutMs) {
        const info = await elHandle.evaluate(el => {
            const r = el.getBoundingClientRect();
            if (!r || r.width <= 0 || r.height <= 0) {
                return { ok: false, reason: 'no-rect' };
            }

            const vw = Math.max(1, window.innerWidth || 1);
            const vh = Math.max(1, window.innerHeight || 1);

            const points = [];
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;

            const push = (x, y) => {
                const px = Math.max(0, Math.min(vw - 1, Math.floor(x)));
                const py = Math.max(0, Math.min(vh - 1, Math.floor(y)));
                points.push([px, py]);
            };

            push(cx, cy);
            push(cx + Math.min(12, r.width / 4), cy);
            push(cx - Math.min(12, r.width / 4), cy);
            push(cx, cy + Math.min(12, r.height / 4));
            push(cx, cy - Math.min(12, r.height / 4));

            let firstBlock = null;
            for (const [x, y] of points) {
                const top = document.elementFromPoint(x, y);

                const describe = (node) => {
                    if (!node) return null;
                    return {
                        tag: node.tagName,
                        class: node.className,
                        role: node.getAttribute?.('role') || null,
                        sameAsTarget: node === el,
                        isDescendant: el.contains(node)
                    };
                };

                if (top && (top === el || el.contains(top))) {
                    return { ok: true, x, y };
                }

                if (top) {
                    if (!firstBlock) {
                        // Which element covers the target, where both are and
                        // how opaque the cover is: the same key on the next
                        // poll means nothing has moved.
                        const ids = window.__surea11yCoverIds || (window.__surea11yCoverIds = new WeakMap());
                        if (!ids.has(top)) ids.set(top, Math.random());
                        const tr = top.getBoundingClientRect();
                        const box = (b) => [b.left, b.top, b.width, b.height].map(Math.round).join(',');
                        firstBlock = {
                            ok: false,
                            reason: 'top-not-target',
                            x,
                            y,
                            top: describe(top),
                            target: describe(el),
                            coverKey: [ids.get(top), box(r), box(tr), getComputedStyle(top).opacity].join('|')
                        };
                    }
                }
            }

            if (firstBlock) return firstBlock;
            return { ok: false, reason: 'no-point-hit' };
        }).catch(() => ({ ok: false, reason: 'evaluate-error' }));

        if (info.ok && Number.isFinite(info.x) && Number.isFinite(info.y)) {
            await page.mouse.move(info.x, info.y);
            // NOTE: Puppeteer's Mouse.click() reads options.count to decide how many down/up
            // cycles to dispatch (each with correct CDP clickCount metadata) - not
            // options.clickCount, which it silently ignores. `count` is what actually produces
            // a real native dblclick for cc === 2.
            await page.mouse.click(info.x, info.y, { button: mouseButton, delay: 20, count: cc });
            return true;
        }

        if (info.coverKey && info.coverKey === coverKey) {
            if (Date.now() - coveredSince >= STILL_COVERED_MS) return false;
        } else {
            coverKey = info.coverKey || null;
            coveredSince = Date.now();
        }

        await sleep(80);
    }

    return false;
}

/**
 * Performs a robust activation on an ElementHandle:
 * 1) verified mouse click (elementFromPoint)
 * 2) handle.click()
 * 3) dom el.click()
 * 4) keyboard Space/Enter (best-effort)
 *
 * ctx is optional, only used for ctx.race labels if provided.
 */
async function activateClickHandle({
                                       page,
                                       handle,
                                       label,
                                       timeoutMs,
                                       ctx,
                                       mouseButton = 'left',
                                       programmatic = false,
                                       clickKind = 'click', // 'click' | 'doubleClick'
                                       scrollIntoView = true
                                   }) {
    const t = Math.max(0, Number(timeoutMs) || 0);

    const kind = (clickKind === 'doubleClick') ? 'doubleClick' : 'click';
    const clickCount = (kind === 'doubleClick') ? 2 : 1;

    // 0) scroll + settle (opt-out via scrollIntoView: false, e.g. to avoid triggering
    // scroll-driven UI such as sticky headers or lazy loaders before the click)
    if (scrollIntoView) {
        try {
            if (ctx) {
                await ctx.race(
                    handle.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest' })),
                    `click scrollIntoView ${label}`
                );
            } else {
                await handle.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
            }
        } catch {}

        try { await wait(page, 80); } catch {}
    }

    // ------------------------------------------------------------
    // Strict programmatic mode: DOM click only
    // ------------------------------------------------------------
    if (programmatic) {
        try {
            if (ctx) {
                await ctx.race(
                    handle.evaluate(el => el.click()),
                    `click domClick ${label}`
                );
            } else {
                await handle.evaluate(el => el.click());
            }
            return;
        } catch (e) {
            const msg = String(e?.message || e || '').toLowerCase();

            if (msg.includes('execution context was destroyed')) {
                await sleep(120);
                const gone = await isHandleGoneOrHidden(handle);
                if (gone) return;
            }

            throw new Error(
                `programmatic click failed for ${label}\n` +
                `domClick: ${e?.message || e}`
            );
        }
    }

    // 1) verified mouse click
    const okMouse = await clickViaMouseAtVerifiedPoint(
        page,
        handle,
        Math.min(3000, t || 3000),
        mouseButton,
        clickCount
    );
    if (okMouse) return;

    let err1 = null, err2 = null;

    const tryKeyboardActivate = async () => {
        // Note: there is no reliable keyboard equivalent for a "double click".
        // We keep this as a last-resort activation attempt.
        try {
            if (ctx) await ctx.race(handle.focus(), `click focus ${label}`);
            else await handle.focus();

            if (mouseButton === 'right') {
                // Keyboard equivalent to context menu
                await page.keyboard.down('Shift');
                await page.keyboard.press('F10');
                await page.keyboard.up('Shift');
                return true;
            }

            await page.keyboard.press('Enter');
            return true;
        } catch {}

        // Space fallback only makes sense for normal activation, not for context menus
        if (mouseButton !== 'right') {
            try {
                if (ctx) await ctx.race(handle.focus(), `click focus ${label}`);
                else await handle.focus();

                await page.keyboard.press('Space');
                return true;
            } catch {}
        }

        return false;
    };

    try {
        const opts = { button: mouseButton };

        // ElementHandle.click() forwards options straight into Mouse.click(), which reads
        // options.count (not options.clickCount) to decide how many click cycles to dispatch.
        if (clickCount > 1) opts.count = clickCount;

        // ElementHandle.click() can resolve without throwing even when the click never actually
        // reaches the element (e.g. it's occluded by an overlay, or pointer-events:none):
        // Puppeteer computes a point and dispatches there, but - unlike our own
        // clickViaMouseAtVerifiedPoint above - does not verify the event actually landed on the
        // target. Instrument the element ourselves so a "success" here can only be trusted if
        // the corresponding event genuinely fired; otherwise fall through to the DOM
        // click()/keyboard fallbacks below instead of silently reporting a false success.
        const landedEvent = (mouseButton === 'right') ? 'contextmenu' : 'click';
        try {
            await handle.evaluate((el, evtName) => {
                el.__wfLanded = false;
                el.addEventListener(evtName, () => { el.__wfLanded = true; }, { capture: true, once: true });
            }, landedEvent);
        } catch {}

        if (ctx) await ctx.race(handle.click(opts), `click handle.click ${label}`);
        else await handle.click(opts);

        let landed = false;
        try { landed = await handle.evaluate(el => !!el.__wfLanded); } catch {}

        if (landed) return;

        err1 = new Error(`handle.click() resolved but the ${landedEvent} event never reached the element (likely occluded)`);
    } catch (e) {
        err1 = e;

        const msg = String(e?.message || e || '');

        if (msg.includes('same JavaScript world')) {
            const ok = await tryKeyboardActivate();
            if (ok) return;
        }
    }

    try {
        // Note: el.click() cannot represent a right-click, nor a real double-click.
        // Keeping this only for left + single click behavior.
        if (mouseButton !== 'right' && clickCount === 1) {
            if (ctx) await ctx.race(handle.evaluate(el => el.click()), `click domClick ${label}`);
            else await handle.evaluate(el => el.click());
            return;
        }
    } catch (e) {
        err2 = e;

        const msg = String(e?.message || e || '').toLowerCase();

        if (msg.includes('execution context was destroyed')) {
            await sleep(120);
            const gone = await isHandleGoneOrHidden(handle);
            if (gone) return;
        }
    }

    // 4) keyboard fallback
    {
        const ok = await tryKeyboardActivate();
        if (ok) return;
    }

    if (err1 && err2) {
        throw new Error(
            `click failed for ${label}\n` +
            `handle.click: ${err1?.message || err1}\n` +
            `domClick: ${err2?.message || err2}`
        );
    }

    // If we skipped domClick due to right button or doubleClick, still throw the handle.click error
    if (err1) {
        throw new Error(
            `click failed for ${label}\n` +
            `handle.click: ${err1?.message || err1}`
        );
    }

    // If neither mouse nor handle.click nor domClick nor keyboard worked, fail explicitly
    if (err2) {
        throw new Error(
            `click failed for ${label}\n` +
            `domClick: ${err2?.message || err2}`
        );
    }

    throw new Error(`click failed for ${label}`);
}

module.exports = {
    clickViaMouseAtVerifiedPoint,
    activateClickHandle
};