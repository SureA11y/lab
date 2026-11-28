'use strict';

// Phase 2 of the AI support (docs/design/ai-cant-tell-roadmap.md, "Phase 2
// design"): success criteria no rule settles. A finder in the lab picks the
// places a criterion could be failed (read only, bounded); the AI is asked one
// question about each, through the same step as the "can't tell" questions;
// a place it flags is a *raised* item, shown apart and unconfirmed until a
// person confirms it (then a finding of its criterion, its source marked).
// The AI only flags: an answer of "no problem" raises nothing and passes no
// criterion.
//
// A step asks with `ai: { raise: ["3.1.2"] }` (or "reading" for the first
// group, the criteria built so far). Every place asked about is kept in
// `canonical.aiRaised` with its status: `raised` (shown), `not-raised`,
// `unresolved`, or `quote-not-found` (the AI flagged words the element does
// not hold: dropped, counted).

/** The first group, in the order the user chose (2026-11-28): built so far. */
const GROUP_READING = ['3.1.2'];
/** The most places asked about per criterion and page. */
const MAX_CANDIDATES = 15;

const RAISE = Object.freeze({
    '3.1.2': Object.freeze({
        check: 'raise-language-of-parts',
        sc: '3.1.2',
        title: 'Language of parts',
        tier: 0,
        evidence: ['element', 'context', 'reported'],
        question: "WCAG 3.1.2 (AA): is this text, or a passage in it, in another language than the one the page gives it (`reported.lang`: the language of this part, from its own or an ancestor's `lang`; `reported.guess`: what the lab's word count suggests), so a screen reader would read it with the wrong pronunciation? Exceptions: proper names (people, places, brands, titles of works), technical terms, words of no clear language, and words or phrases that have become part of the surrounding language (\"café\", \"déjà vu\" in English). Answer \"fail\" when a passage of words is in another language and nothing marks it with its own `lang`; then give the exact words in \"quote\", as they appear, and the language in \"why\". Answer \"pass\" when the text is in its part's language, or what differs is one of the exceptions. \"unsure\" when you cannot tell.",
        howToCheck: {
            steps: [
                'Read the text and decide which language each passage is in.',
                "Compare it with the language of its part of the page (its own lang, or the nearest ancestor's, else the page's).",
                'Leave out proper names, technical terms and words taken into the surrounding language.',
            ],
            passWhen: 'Every passage is in the language of its part, or what differs is an exception.',
            failWhen: 'A passage is in another language and has no lang of its own (WCAG 3.1.2, H58).',
        },
    }),
});

/** The criteria a step's `raise` asks for, built ones only, in order. */
function raiseCriteriaOf(value) {
    if (!value) return [];
    const list = value === 'reading' ? GROUP_READING : (Array.isArray(value) ? value.map(String) : String(value).split(/[\s,]+/));
    return [...new Set(list.map((s) => s.trim()).filter((s) => Object.prototype.hasOwnProperty.call(RAISE, s)))];
}

/** The registry-like entry the shared ask step takes. */
function entryOf(sc) {
    const r = RAISE[sc];
    return r ? { check: r.check, tier: 0, question: r.question, evidence: r.evidence, raise: true } : null;
}

// The places in the page, read only. Runs in the page: no outside references.
function languageOfPartsInPage(max) {
    const STOP = {
        en: ['the', 'and', 'of', 'to', 'is', 'are', 'with', 'for', 'this', 'that', 'you', 'your', 'from', 'not', 'have', 'will', 'our', 'we', 'it', 'on', 'be', 'by', 'or', 'at', 'was'],
        fr: ['le', 'la', 'les', 'des', 'et', 'est', 'une', 'un', 'du', 'pour', 'dans', 'que', 'qui', 'sur', 'avec', 'pas', 'vous', 'nous', 'sont', 'au', 'aux', 'ce', 'cette', 'il', 'elle'],
        de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'ein', 'eine', 'den', 'dem', 'zu', 'auf', 'für', 'sie', 'wir', 'ich', 'sind', 'auch', 'von', 'im', 'des', 'wird', 'oder', 'bei'],
        es: ['el', 'los', 'las', 'del', 'y', 'es', 'una', 'para', 'con', 'que', 'por', 'su', 'sus', 'como', 'pero', 'más', 'está', 'son', 'al', 'lo', 'este', 'esta', 'muy', 'también', 'nuestro'],
        it: ['il', 'gli', 'della', 'delle', 'di', 'che', 'è', 'per', 'una', 'non', 'con', 'sono', 'del', 'nel', 'alla', 'questo', 'questa', 'anche', 'più', 'dei', 'come', 'ma', 'ci', 'si', 'lo'],
        pt: ['o', 'os', 'as', 'da', 'do', 'das', 'dos', 'e', 'é', 'um', 'uma', 'para', 'com', 'não', 'que', 'em', 'no', 'na', 'mais', 'por', 'se', 'são', 'seu', 'sua', 'você'],
        nl: ['de', 'het', 'een', 'en', 'van', 'is', 'niet', 'met', 'voor', 'op', 'dat', 'die', 'zijn', 'ook', 'je', 'wij', 'we', 'aan', 'bij', 'wordt', 'naar', 'uit', 'maar', 'deze', 'om'],
    };
    const LATIN = ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'sk', 'sv', 'da', 'no', 'nb', 'fi', 'et', 'hu', 'ro', 'hr', 'sl', 'tr', 'ca', 'eu', 'ga', 'cy', 'lt', 'lv', 'is', 'sq', 'ms', 'id', 'vi'];
    const SCRIPTS = [
        ['Cyrillic', /[Ѐ-ӿ]/g, ['ru', 'uk', 'bg', 'sr', 'mk', 'be', 'kk']],
        ['Greek', /[Ͱ-Ͽ]/g, ['el']],
        ['Arabic', /[؀-ۿ]/g, ['ar', 'fa', 'ur']],
        ['Hebrew', /[֐-׿]/g, ['he', 'yi']],
        ['CJK', /[぀-ヿ㐀-鿿가-힯]/g, ['zh', 'ja', 'ko']],
        ['Devanagari', /[ऀ-ॿ]/g, ['hi', 'mr', 'ne']],
        ['Thai', /[฀-๿]/g, ['th']],
    ];
    const primary = (l) => String(l || '').trim().toLowerCase().split('-')[0];
    const pageLang = primary(document.documentElement.getAttribute('lang'));
    const langOf = (el) => { const c = el.closest('[lang]'); return c ? primary(c.getAttribute('lang')) : ''; };
    const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const selectorOf = (el) => {
        if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
        const parts = [];
        for (let e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
            if (e.id && document.querySelectorAll('#' + CSS.escape(e.id)).length === 1) { parts.unshift('#' + CSS.escape(e.id)); break; }
            const same = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
            parts.unshift(e.tagName.toLowerCase() + (same.length > 1 ? `:nth-of-type(${same.indexOf(e) + 1})` : ''));
        }
        return parts.join(' > ');
    };
    const guessOf = (text, lang) => {
        for (const [name, re, langs] of SCRIPTS) {
            const n = (text.match(re) || []).length;
            if (n >= 3 && !langs.includes(lang)) return { by: 'script', script: name, letters: n };
        }
        const words = (text.toLowerCase().match(/\p{L}+/gu) || []);
        if (words.length < 3 || (lang && !LATIN.includes(lang))) return null;
        const count = {};
        for (const [l, list] of Object.entries(STOP)) count[l] = words.filter((w) => list.includes(w)).length;
        const own = count[lang] || 0;
        const best = Object.entries(count).filter(([l]) => l !== lang).sort((a, b) => b[1] - a[1])[0];
        if (!best || best[1] < 2 || best[1] < own * 1.5 + 1) return null;
        return { by: 'words', language: best[0], words: best[1], ownWords: own, of: words.length };
    };
    const BLOCK = 'p, li, blockquote, q, td, th, dd, dt, figcaption, caption, label, h1, h2, h3, h4, h5, h6, legend, summary';
    const INLINE = 'a, button, em, i, cite, span, b, strong, small, abbr, mark';
    const found = [];
    const take = (el) => {
        if (found.length >= max * 3) return;
        if (el.closest('script, style, code, pre, kbd, samp, svg, [aria-hidden="true"], [hidden]') || !shown(el)) return;
        const text = String(el.innerText || '').replace(/\s+/g, ' ').trim();
        if (text.length < 2) return;
        const lang = langOf(el) || pageLang;
        const guess = guessOf(text, lang);
        if (!guess) return;
        found.push({ el, text, lang, guess });
    };
    for (const el of document.querySelectorAll(BLOCK)) take(el);
    for (const el of document.querySelectorAll(INLINE)) take(el);
    // The smallest element that holds the run: an element gives way to a
    // flagged one inside it for the same language or script, or that holds
    // most of its text.
    const kind = (g) => g.script || g.language;
    const keep = found.filter((f) => !found.some((g) => g !== f && f.el.contains(g.el) && (kind(g.guess) === kind(f.guess) || g.text.length >= f.text.length * 0.6)));
    return keep.slice(0, max).map((f) => ({
        selector: selectorOf(f.el),
        html: f.el.outerHTML.slice(0, 1500),
        text: f.text.slice(0, 1000),
        facts: { lang: f.lang || null, pageLang: pageLang || null, guess: f.guess },
    }));
}

const FINDERS = { '3.1.2': languageOfPartsInPage };

/** The places a criterion's finder picks on the page; [] when it cannot run. */
async function findCandidates(page, sc, max = MAX_CANDIDATES) {
    const finder = FINDERS[sc];
    if (!finder || !page || typeof page.evaluate !== 'function') return [];
    try {
        const found = await page.evaluate(finder, max);
        return Array.isArray(found) ? found : [];
    } catch {
        return [];
    }
}

const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A place's status from the AI's answer: `raised` only for a sure "fail"
 * whose quote is in the element's text; a sure "pass" is `not-raised`;
 * anything else `unresolved`.
 */
function statusOf(ai, text) {
    if (!ai || ai.provenance !== 'ai-supported') return 'unresolved';
    if (ai.verdict === 'pass') return 'not-raised';
    if (ai.verdict !== 'fail') return 'unresolved';
    const q = squash(ai.quote);
    return q.length >= 2 && squash(text).includes(q) ? 'raised' : 'quote-not-found';
}

module.exports = { RAISE, GROUP_READING, MAX_CANDIDATES, raiseCriteriaOf, entryOf, findCandidates, statusOf, languageOfPartsInPage };
