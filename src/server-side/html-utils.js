// Small helper library to manipulate HTML strings on the server side.
// Requires: cheerio

const cheerio = require('cheerio');

/**
 * Internal helper: load HTML with cheerio and handle errors.
 * Returns { $, error } where $ is a cheerio instance or null.
 */
function loadHtml(htmlString) {
    let $ = null;
    try {
        $ = cheerio.load(htmlString || '');
        return { $, error: null };
    } catch (error) {
        console.error('html-utils: failed to parse HTML:', error);
        return { $, error };
    }
}

/**
 * Escape a string for safe HTML embedding.
 */
function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Append HTML content inside all elements that match the selector.
 * Returns the modified HTML string. If nothing matches, returns the original.
 */
function appendHtml(htmlString, selector, htmlToAppend) {
    const { $, error } = loadHtml(htmlString);
    if (error || !selector) return htmlString;

    const target = $(selector);
    if (!target.length) return htmlString;

    target.append(htmlToAppend || '');
    return $.html();
}

/**
 * Prepend HTML content inside all elements that match the selector.
 */
function prependHtml(htmlString, selector, htmlToPrepend) {
    const { $, error } = loadHtml(htmlString);
    if (error || !selector) return htmlString;

    const target = $(selector);
    if (!target.length) return htmlString;

    target.prepend(htmlToPrepend || '');
    return $.html();
}

/**
 * Insert HTML content immediately after each element that matches the selector.
 */
function insertAfter(htmlString, selector, htmlToInsert) {
    const { $, error } = loadHtml(htmlString);
    if (error || !selector) return htmlString;

    const target = $(selector);
    if (!target.length) return htmlString;

    target.after(htmlToInsert || '');
    return $.html();
}

/**
 * Insert HTML content immediately before each element that matches the selector.
 */
function insertBefore(htmlString, selector, htmlToInsert) {
    const { $, error } = loadHtml(htmlString);
    if (error || !selector) return htmlString;

    const target = $(selector);
    if (!target.length) return htmlString;

    target.before(htmlToInsert || '');
    return $.html();
}

/**
 * Replace the inner HTML of all elements that match the selector.
 */
function replaceInnerHtml(htmlString, selector, newInnerHtml) {
    const { $, error } = loadHtml(htmlString);
    if (error || !selector) return htmlString;

    const target = $(selector);
    if (!target.length) return htmlString;

    target.html(newInnerHtml || '');
    return $.html();
}

/**
 * Replace each matched element with given HTML string.
 */
function replaceElement(htmlString, selector, replacementHtml) {
    const { $, error } = loadHtml(htmlString);
    if (error || !selector) return htmlString;

    const target = $(selector);
    if (!target.length) return htmlString;

    target.replaceWith(replacementHtml || '');
    return $.html();
}

/**
 * Remove all elements that match the selector.
 */
function removeElements(htmlString, selector) {
    const { $, error } = loadHtml(htmlString);
    if (error || !selector) return htmlString;

    const target = $(selector);
    if (!target.length) return htmlString;

    target.remove();
    return $.html();
}

/**
 * Set an attribute on all elements that match the selector.
 * If value is null or undefined, the attribute is removed.
 */
function setAttr(htmlString, selector, attrName, value) {
    const { $, error } = loadHtml(htmlString);
    if (error || !selector || !attrName) return htmlString;

    const target = $(selector);
    if (!target.length) return htmlString;

    if (value === null || value === undefined) {
        target.removeAttr(attrName);
    } else {
        target.attr(attrName, String(value));
    }

    return $.html();
}

/**
 * Get the attribute value from the first element that matches the selector.
 * Returns undefined if not found.
 */
function getAttr(htmlString, selector, attrName) {
    const { $, error } = loadHtml(htmlString);
    if (error || !selector || !attrName) return undefined;

    const target = $(selector).first();
    if (!target.length) return undefined;

    const val = target.attr(attrName);
    return val === undefined ? undefined : String(val);
}

/**
 * Get the text content of the first element that matches the selector.
 * Returns empty string if not found.
 */
function getText(htmlString, selector) {
    const { $, error } = loadHtml(htmlString);
    if (error || !selector) return '';

    const target = $(selector).first();
    if (!target.length) return '';

    return target.text();
}

/**
 * Set the text content of all elements that match the selector.
 * New text is HTML escaped.
 */
function setText(htmlString, selector, text) {
    const { $, error } = loadHtml(htmlString);
    if (error || !selector) return htmlString;

    const target = $(selector);
    if (!target.length) return htmlString;

    target.text(text == null ? '' : String(text));
    return $.html();
}

/**
 * Get the inner HTML of the first element that matches the selector.
 * Returns empty string if not found.
 */
function getInnerHtml(htmlString, selector) {
    const { $, error } = loadHtml(htmlString);
    if (error || !selector) return '';

    const target = $(selector).first();
    if (!target.length) return '';

    return target.html() || '';
}

/**
 * Wrap each matched element inside a wrapper HTML.
 * The wrapper HTML must contain a single root element.
 */
function wrap(htmlString, selector, wrapperHtml) {
    const { $, error } = loadHtml(htmlString);
    if (error || !selector || !wrapperHtml) return htmlString;

    const target = $(selector);
    if (!target.length) return htmlString;

    target.wrap(wrapperHtml);
    return $.html();
}

/**
 * Add one or more classes to all matched elements.
 * classNames can be a string or an array.
 */
function addClass(htmlString, selector, classNames) {
    const { $, error } = loadHtml(htmlString);
    if (error || !selector) return htmlString;

    const target = $(selector);
    if (!target.length) return htmlString;

    const list = Array.isArray(classNames)
        ? classNames
        : String(classNames || '').split(/\s+/).filter(Boolean);

    if (!list.length) return htmlString;

    target.addClass(list.join(' '));
    return $.html();
}

/**
 * Remove one or more classes from all matched elements.
 */
function removeClass(htmlString, selector, classNames) {
    const { $, error } = loadHtml(htmlString);
    if (error || !selector) return htmlString;

    const target = $(selector);
    if (!target.length) return htmlString;

    const list = Array.isArray(classNames)
        ? classNames
        : String(classNames || '').split(/\s+/).filter(Boolean);

    if (!list.length) return htmlString;

    target.removeClass(list.join(' '));
    return $.html();
}

/**
 * Toggle a class on all matched elements.
 * If force is true or false, sets the class presence explicitly.
 */
function toggleClass(htmlString, selector, className, force) {
    const { $, error } = loadHtml(htmlString);
    if (error || !selector || !className) return htmlString;

    const target = $(selector);
    if (!target.length) return htmlString;

    if (force === true) {
        target.addClass(className);
    } else if (force === false) {
        target.removeClass(className);
    } else {
        target.toggleClass(className);
    }

    return $.html();
}

module.exports = {
    escapeHtml,
    appendHtml,
    prependHtml,
    insertAfter,
    insertBefore,
    replaceInnerHtml,
    replaceElement,
    removeElements,
    setAttr,
    getAttr,
    getText,
    setText,
    getInnerHtml,
    wrap,
    addClass,
    removeClass,
    toggleClass
};
