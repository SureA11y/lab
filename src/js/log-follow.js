// A log that keeps its last line in sight while the user is at its end, and
// leaves the scroll where it is once they move away to read something: new
// lines then arrive without moving it. Scrolling back down until the last
// line shows follows the log again.
//
// Whether the user is at the end is read when the log scrolls, never as a
// line is added: measuring it then would lay out the whole log once per line,
// and a run's log can arrive thousands of lines at once. Scrolling to the end
// waits for the next frame, so a batch of lines scrolls once.

// How far from the very end still counts as at it: fractional scroll
// positions under zoom stop a pixel or so short.
const END_SLACK_PX = 2;

export function isAtLogEnd(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= END_SLACK_PX;
}

/**
 * @param {HTMLElement} el The scrolling log box.
 * @returns {{
 *   lineAdded: () => void,
 *   reset: () => void,
 *   isFollowing: () => boolean,
 *   move: (fn: () => void) => void,
 *   destroy: () => void
 * }}
 */
export function createLogFollow(el) {
    let following = true;
    let frame = 0;
    // Where the last scroll to the end left the log. A scroll event at or
    // below it is that scroll (its event arrives a frame later, when more
    // lines may have made the log taller) or the user going further down;
    // only one above it is the user leaving the end.
    let followedTop = -1;

    function onScroll() {
        if (following && followedTop >= 0 && el.scrollTop >= followedTop - 1) return;
        following = isAtLogEnd(el);
        followedTop = -1;
    }
    el.addEventListener('scroll', onScroll, {passive: true});

    function toEnd() {
        el.scrollTop = el.scrollHeight;
        followedTop = el.scrollTop;
    }

    function lineAdded() {
        if (!following || frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            if (following) toEnd();
        });
    }

    // An emptied log starts again at its end.
    function reset() {
        following = true;
        followedTop = -1;
    }

    // Moving the box elsewhere in the page (into a dialog and back) loses its
    // scroll position: one following the log goes back to its end, one being
    // read goes back to the line at its top.
    function move(fn) {
        const anchor = following ? null : topLine();
        const offset = anchor ? lineTop(anchor) : 0;
        fn();
        if (following) {
            toEnd();
        } else if (anchor && anchor.parentNode === el) {
            el.scrollTop += lineTop(anchor) - offset;
            following = isAtLogEnd(el);
        }
    }

    // A line's top, from the top of the box's visible part.
    function lineTop(line) {
        return line.getBoundingClientRect().top - el.getBoundingClientRect().top;
    }

    function topLine() {
        const boxTop = el.getBoundingClientRect().top;
        for (const line of el.children) {
            if (line.getBoundingClientRect().bottom > boxTop) return line;
        }
        return null;
    }

    function destroy() {
        el.removeEventListener('scroll', onScroll);
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
    }

    return {lineAdded, reset, isFollowing: () => following, move, destroy};
}
