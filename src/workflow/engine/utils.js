'use strict';

function isDisabled(action) {
    return !!(action && action.disabled === true);
}

/** @param {any} v */
function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim().length > 0;
}

/** @param {any} v @param {number} fallback */
function toNumber(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

/** @param {any} v */
function toBool(v) {
    return v === true;
}

/** @param {number} ms */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function cloneDeep(obj) {
    return JSON.parse(JSON.stringify(obj));
}

module.exports = {
    isDisabled,
    isNonEmptyString,
    toNumber,
    toBool,
    sleep,
    cloneDeep
};
