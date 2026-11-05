// How many elements a finding's occurrences are about, as the results show
// it next to the occurrence count ("284 occurrences · 142 elements").
//
// In a merged scan, the same element of two contexts can be two
// occurrences: a framework numbers the ids it makes as it goes (mat-option-0
// at a desktop width, mat-option-284 once the page is laid out again at a
// phone width), so the element has another id, another selector, and the
// merge cannot tell it is the same one. Its markup, children included, is
// otherwise the same. An element is so told apart by its page and its markup
// with the attributes that hold or point at ids left out, and counted once
// for all the contexts it occurs in. Within one context every occurrence is
// an element of its own: ten empty buttons are ten elements, whatever their
// markup. This only counts; occurrences are never joined on it.

const ID_ATTRIBUTES = [
    'id', 'for', 'headers', 'form', 'list',
    'aria-activedescendant', 'aria-controls', 'aria-describedby', 'aria-details',
    'aria-errormessage', 'aria-flowto', 'aria-labelledby', 'aria-owns',
];

const ID_ATTRIBUTE_RE = new RegExp(
    `\\s(?:${ID_ATTRIBUTES.join('|')})\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>\`]+)`,
    'gi'
);

/** An element's markup without the attributes that hold or point at ids. */
export function markupWithoutIds(html) {
    return String(html || '').replace(ID_ATTRIBUTE_RE, '').replace(/\s+/g, ' ').trim();
}

function pagesOf(n) {
    const urls = Array.isArray(n?.urls) ? n.urls : (n?.pageUrl ? [n.pageUrl] : []);
    return [...new Set(urls.map((u) => String(u || '').trim()).filter(Boolean))].sort().join('\n');
}

function elementKey(n) {
    const markup = markupWithoutIds(n?.html);
    // Without markup, its selector is all there is to tell it by.
    const what = markup || `selector:${Array.isArray(n?.target) ? n.target.join(', ') : ''}`;
    return `${pagesOf(n)}\n${what}`;
}

/**
 * The number of elements the occurrences are about: for each markup, the
 * most elements any one context has of it. Within a context an element is
 * told by its selector, so the same element flagged twice (two checks, in a
 * report saved before they were listed under one occurrence) counts once.
 */
export function elementCount(nodes) {
    const byKey = new Map();
    for (const n of Array.isArray(nodes) ? nodes : []) {
        const key = elementKey(n);
        const perContext = byKey.get(key) || new Map();
        const target = Array.isArray(n?.target) && n.target.length ? n.target.join(', ') : null;
        const contexts = Array.isArray(n?.contexts) && n.contexts.length ? n.contexts : [''];
        for (const c of new Set(contexts.map(String))) {
            const seen = perContext.get(c) || { targets: new Set(), untargeted: 0 };
            if (target === null) seen.untargeted += 1;
            else seen.targets.add(target);
            perContext.set(c, seen);
        }
        byKey.set(key, perContext);
    }
    let total = 0;
    for (const perContext of byKey.values()) {
        total += Math.max(...[...perContext.values()].map((s) => s.targets.size + s.untargeted));
    }
    return total;
}

/**
 * " · 142 elements" when the occurrences are about fewer elements than
 * there are occurrences, '' otherwise.
 */
export function elementCountText(nodes, occurrenceCount) {
    const n = elementCount(nodes);
    if (!n || n >= occurrenceCount) return '';
    return ` · ${n} element${n === 1 ? '' : 's'}`;
}
