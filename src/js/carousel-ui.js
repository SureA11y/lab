'use strict';

export function enhanceAsLiveCarousel(itemsHostEl, {
    title = "Live stream",
    ariaLabel = title,
    visibleCount: visibleCountOpt = 4,

    responsive = true,
    // Breakpoints are "minWidth" rules: at/above minWidth => visibleCount
    // Default: < 880 => 2, >= 880 => 4
    breakpoints = null,

    announceNewItems = false,   // keep false for live stream
    addBaseStyles = true,       // inject minimal CSS once
    firstLabel = "First page",
    prevLabel = "Previous items",
    nextLabel = "Next items",
    lastLabel = "Last page",
} = {}) {
    let visibleCount = visibleCountOpt;

    if (!(itemsHostEl instanceof Element)) {
        throw new TypeError("enhanceAsLiveCarousel: itemsHostEl must be a DOM Element.");
    }

    // Inject CSS once (optional)
    const STYLE_ID = "live-carousel-styles";
    if (addBaseStyles && !document.getElementById(STYLE_ID)) {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
  .live-carousel{--itemsPerPage:3;--gap:12px;max-width:100%}
  .live-carousel .carousel-header{display:flex;align-items:center;gap:12px}
  .live-carousel .carousel-controls{display:flex;align-items:center;gap:10px}
  .live-carousel .carousel-btn{padding:6px 10px}
  .live-carousel .carousel-viewport{margin-top:10px;overflow:hidden;outline:none; background-color:var(--neutral-75)}
  .live-carousel .carousel-track{display:flex;gap:var(--gap);will-change:transform;transition:transform 1500ms ease}
  .live-carousel .carousel-item{
    display:flex; flex-direction: column;
    flex:0 0 calc((100% - (var(--gap) * (var(--itemsPerPage) - 1))) / var(--itemsPerPage));
    min-width:0
  }
  .carousel-item > :last-child {
  margin-top: auto;
}
  .live-carousel .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media (prefers-reduced-motion: reduce){.live-carousel .carousel-track{transition:none}}
`;
        document.head.appendChild(style);
    }

    // Helpers
    const uid = `lc_${Math.random().toString(36).slice(2, 9)}`;
    const trackId = `${uid}_track`;
    const titleId = `${uid}_title`;

    function el(tag, attrs = {}, ...children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === "class") node.className = v;
            else if (k === "dataset") Object.assign(node.dataset, v);
            else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
            else if (v === true) node.setAttribute(k, "");
            else if (v != null) node.setAttribute(k, String(v));
        }
        for (const c of children) {
            if (c == null) continue;
            if (typeof c === "string") node.appendChild(document.createTextNode(c));
            else node.appendChild(c);
        }
        return node;
    }

    // Build the carousel shell
    const root = el("section", {
        class: "live-carousel",
        "aria-roledescription": "carousel",
        "aria-label": ariaLabel,
        dataset: { carousel: "" }
    });
    root.style.setProperty('--itemsPerPage', String(visibleCount));

    const header = el("div", { class: "carousel-header" },
        el("h2", { class: "carousel-title", id: titleId }, title),
        el("div", { class: "carousel-controls", role: "group", "aria-label": "Carousel controls" },
            el("button", {
                type: "button",
                class: "carousel-btn",
                "aria-controls": trackId,
                "aria-label": firstLabel,
                dataset: { first: "" }
            }, "⏮"),
            el("button", {
                type: "button",
                class: "carousel-btn",
                "aria-controls": trackId,
                "aria-label": prevLabel,
                dataset: { prev: "" }
            }, "◀"),
            el("button", {
                type: "button",
                class: "carousel-btn",
                "aria-controls": trackId,
                "aria-label": nextLabel,
                dataset: { next: "" }
            }, "▶"),
            el("button", {
                type: "button",
                class: "carousel-btn",
                "aria-controls": trackId,
                "aria-label": lastLabel,
                dataset: { last: "" }
            }, "⏭")
        )
    );

    const status = el("p", { class: "sr-only", "aria-live": "polite", "aria-atomic": "true", dataset: { status: "" } });

    const viewport = el("div", {
        class: "carousel-viewport",
        tabindex: "0",
        role: "region",
        "aria-label": "Items viewport",
        dataset: { viewport: "" }
    });

    const track = el("div", {
        class: "carousel-track",
        id: trackId,
        dataset: { track: "" },
        role: "group",
        "aria-labelledby": titleId
    });

    viewport.appendChild(track);
    root.appendChild(header);
    root.appendChild(status);
    root.appendChild(viewport);

    // Replace itemsHostEl in place with root, and move content
    const parent = itemsHostEl.parentNode;
    if (!parent) throw new Error("enhanceAsLiveCarousel: itemsHostEl must be in the DOM.");

    // Move existing children into track and ensure a class for sizing
    const existingItems = Array.from(itemsHostEl.children);
    existingItems.forEach((child) => {
        child.classList.add("carousel-item");
        track.appendChild(child);
    });

    // Put carousel root where the old container was
    parent.replaceChild(root, itemsHostEl);

    // --- Behavior ---
    const btnFirst = root.querySelector("[data-first]");
    const btnPrev = root.querySelector("[data-prev]");
    const btnNext = root.querySelector("[data-next]");
    const btnLast = root.querySelector("[data-last]");
    const liveStatus = root.querySelector("[data-status]");

    let pageIndex = 0;

    // --- burst smoothing ---
    let pendingAppend = [];
    let appendFlushScheduled = false;
    let suspendObservers = 0; // prevents MO-triggered extra renders during our own updates

    // Optional: reduce how often we auto-follow to the newest page
    let followCooldownMs = 250;
    let lastFollowAt = 0;

    function scheduleAppendFlush() {
        if (appendFlushScheduled) return;
        appendFlushScheduled = true;

        requestAnimationFrame(() => {
            appendFlushScheduled = false;
            flushPendingAppend();
        });
    }

    function flushPendingAppend() {
        if (!pendingAppend.length) return;

        // Snapshot state ONCE for the whole burst
        const prevPageCount = pageCount();
        const wasOnLastPage = pageIndex === (prevPageCount - 1);
        // Filling an empty carousel (a replayed log, when watching a queued
        // run) lands on its page directly instead of sliding there from the first.
        const wasEmpty = track.children.length === 0;

        suspendObservers++;
        try {
            // Append all pending nodes in one go, ideally via fragment
            const frag = document.createDocumentFragment();

            for (const n of pendingAppend) {
                if (n?.classList) n.classList.add("carousel-item");
                frag.appendChild(n);
            }
            track.appendChild(frag);
        } finally {
            suspendObservers--;
        }

        pendingAppend = [];

        const newPageCount = pageCount();
        pageIndex = clampPage(pageIndex);

        // Auto-follow only if user was on last page, and (optionally) not too often
        if (wasOnLastPage && newPageCount > prevPageCount) {
            const now = performance.now();
            if (now - lastFollowAt >= followCooldownMs) {
                pageIndex = newPageCount - 1;
                lastFollowAt = now;
            }
        }

        // Single update for the whole burst
        updateButtons();
        if (announceNewItems) {
            // If you want accurate count here, track how many were queued in the burst.
            // For now, this is intentionally quiet in live-stream mode.
        }
        render({instant: wasEmpty});
    }

    function setVisibleCount(n) {
        const next = Number(n);
        if (!Number.isFinite(next) || next <= 0) return;

        visibleCount = Math.floor(next);
        root.style.setProperty('--itemsPerPage', String(visibleCount));

        // keep the current page valid after changing
        pageIndex = clampPage(pageIndex);
        updateButtons();
        render({instant: true});
    }

    function normalizeBreakpoints(bps, fallbackCount) {
        // Accept:
        // - null/undefined => use defaults (if responsive enabled)
        // - Array of objects: [{ minWidth: 0, count: 2 }, { minWidth: 880, count: 4 }]
        // - Array of tuples: [[0, 2], [880, 4]]
        if (!bps) return null;

        const out = [];

        for (const bp of bps) {
            let minWidth, count;

            if (Array.isArray(bp)) {
                minWidth = bp[0];
                count = bp[1];
            } else if (bp && typeof bp === "object") {
                minWidth = bp.minWidth;
                count = bp.count;
            } else {
                continue;
            }

            minWidth = Number(minWidth);
            count = Number(count);

            if (!Number.isFinite(minWidth) || minWidth < 0) continue;
            if (!Number.isFinite(count) || count <= 0) continue;

            out.push({ minWidth: Math.floor(minWidth), count: Math.floor(count) });
        }

        // Ensure we always have a base rule
        if (!out.some(x => x.minWidth === 0)) {
            out.push({ minWidth: 0, count: Math.max(1, Math.floor(Number(fallbackCount) || 1)) });
        }

        // Sort ascending by minWidth, then keep last win for duplicates
        out.sort((a, b) => a.minWidth - b.minWidth);

        // Deduplicate by minWidth, last entry wins
        const dedup = [];
        for (const bp of out) {
            const last = dedup[dedup.length - 1];
            if (last && last.minWidth === bp.minWidth) {
                last.count = bp.count;
            } else {
                dedup.push({ ...bp });
            }
        }

        return dedup;
    }

    const DEFAULT_BREAKPOINTS = [
        { minWidth: 0, count: 1 },
        { minWidth: 600, count: 2 },
        { minWidth: 750, count: 3 },
        { minWidth: 900, count: 4 }
    ];

    const normalizedBreakpoints = normalizeBreakpoints(
        breakpoints || (responsive ? DEFAULT_BREAKPOINTS : null),
        visibleCountOpt
    );

    function desiredCountForWidth(widthPx) {
        // If responsive is off or no breakpoints, stick to the configured visibleCount
        if (!responsive || !normalizedBreakpoints) return visibleCount;

        const w = Number(widthPx);
        if (!Number.isFinite(w) || w < 0) return visibleCount;

        // Pick the last breakpoint whose minWidth is <= current width
        let chosen = normalizedBreakpoints[0].count;
        for (const bp of normalizedBreakpoints) {
            if (w >= bp.minWidth) chosen = bp.count;
            else break;
        }
        return chosen;
    }

    function autoSetVisibleCountByWidth(widthPx) {
        const desired = desiredCountForWidth(widthPx);

        // Avoid pointless work and avoid re-render loops
        if (desired !== visibleCount) setVisibleCount(desired);
    }


    function items() {
        return Array.from(track.children);
    }

    function pageCount() {
        return Math.max(1, Math.ceil(items().length / visibleCount));
    }

    function clampPage(i) {
        return Math.max(0, Math.min(i, pageCount() - 1));
    }

    function getItemWidth() {
        const first = items()[0];
        if (!first) return 0;
        const rect = first.getBoundingClientRect();
        const style = getComputedStyle(track);
        const gap = parseFloat(style.columnGap || style.gap || "0") || 0;
        return rect.width + gap;
    }

    function announce(text) {
        liveStatus.textContent = text;
    }

    function updateButtons() {
        const pc = pageCount();
        btnFirst.disabled = pageIndex <= 0;
        btnPrev.disabled = pageIndex <= 0;
        btnNext.disabled = pageIndex >= pc - 1;
        btnLast.disabled = pageIndex >= pc - 1;
    }

    /**
     * `instant` moves without the slide: for a change of size (the carousel
     * becoming visible measures its items for the first time) or a carousel
     * filled from empty, where sliding from the first page would only show
     * the arithmetic catching up.
     */
    function render({instant = false} = {}) {
        // Enforce the 3-up sizing rule even if visibleCount changes
        // (If you want fully dynamic, you can change CSS variable approach)
        const w = getItemWidth();
        const x = pageIndex * visibleCount * w;
        if (instant) {
            track.style.transition = 'none';
            track.style.transform = `translateX(${-x}px)`;
            void track.offsetWidth; // apply it now, before the transition returns
            track.style.transition = '';
        } else {
            track.style.transform = `translateX(${-x}px)`;
        }

        updateButtons();
        announce(`Showing page ${pageIndex + 1} of ${pageCount()}`);
    }

    function goToPage(i) {
        pageIndex = clampPage(i);
        render();
    }

    function prev() { goToPage(pageIndex - 1); }
    function next() { goToPage(pageIndex + 1); }
    function first() { goToPage(0); }
    function last() { goToPage(pageCount() - 1); }

    // Keyboard when viewport is focused
    function onViewportKeyDown(e) {
        switch (e.key) {
            case "ArrowLeft":
            case "PageUp":
                e.preventDefault();
                prev();
                break;
            case "ArrowRight":
            case "PageDown":
                e.preventDefault();
                next();
                break;
            case "Home":
                e.preventDefault();
                goToPage(0);
                break;
            case "End":
                e.preventDefault();
                goToPage(pageCount() - 1);
                break;
            default:
                break;
        }
    }
    viewport.addEventListener("keydown", onViewportKeyDown);

    btnFirst.addEventListener("click", first);
    btnPrev.addEventListener("click", prev);
    btnNext.addEventListener("click", next);
    btnLast.addEventListener("click", last);

    // Observe resizing, also auto-adjust visibleCount based on viewport width
    const ro = new ResizeObserver((entries) => {
        const w = entries?.[0]?.contentRect?.width || viewport.clientWidth || 0;
        autoSetVisibleCountByWidth(w);
        render({instant: true});
    });
    ro.observe(viewport);

    // Public method: append without jumping
// Public method: append, and auto-follow only if user is on last page
    function append(newEls) {
        const arr = Array.isArray(newEls) ? newEls : [newEls];
        if (!arr.length) return;

        // Queue, do not re-render for every item
        for (const n of arr) {
            if (!n) continue;
            pendingAppend.push(n);
        }

        scheduleAppendFlush();
    }

    function clear() {
        // Remove all items
        while (track.firstChild) {
            track.removeChild(track.firstChild);
        }

        // Reset page state
        pageIndex = 0;

        // Update UI
        updateButtons();
        render();
    }


    let moRenderScheduled = false;

    const mo = new MutationObserver(() => {
        if (suspendObservers > 0) return;

        // Coalesce observer-triggered renders
        if (moRenderScheduled) return;
        moRenderScheduled = true;

        requestAnimationFrame(() => {
            moRenderScheduled = false;
            pageIndex = clampPage(pageIndex);
            updateButtons();
            render();
        });
    });
    mo.observe(track, { childList: true });

    // Init
    autoSetVisibleCountByWidth(viewport.clientWidth || 0);
    render();

    return {
        root,
        viewport,
        track,

        goToPage,
        first,
        prev,
        next,
        last,
        append,
        clear,
        setVisibleCount,

        destroy() {
            viewport.removeEventListener("keydown", onViewportKeyDown);
            btnFirst.removeEventListener("click", first);
            btnPrev.removeEventListener("click", prev);
            btnNext.removeEventListener("click", next);
            btnLast.removeEventListener("click", last);
            ro.disconnect();
            mo.disconnect();
        }
    };
}