'use strict';

// The standards the lab knows besides WCAG: those of the installed packs for
// surea11y core. Every @surea11y/pack-* package the lab depends on is tried,
// surea11y's own (EN 301 549's and WAI-ARIA's) whether depended on or not,
// and any named in A11Y_PACKS (comma-separated package names or paths); a
// pack that does not load is left out. Each one's standard (its key, name,
// versions and profiles) comes from the pack itself, so a new standard needs
// no code of the lab's own: install its pack.

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PACK_NAME = /^@surea11y\/pack-[a-z0-9-]+$/;

// The packs of surea11y's own standards, tried whether or not the lab
// depends on them yet: one installed (by npm, or linked while it is not yet
// published) is offered, one that isn't is left out.
const FIRST_PARTY = ['@surea11y/pack-en301549', '@surea11y/pack-wai-aria'];

// The packs the lab depends on, in package.json's order.
function dependedOn(pkg) {
    const deps = { ...(pkg && pkg.dependencies), ...(pkg && pkg.optionalDependencies) };
    return Object.keys(deps).filter((name) => PACK_NAME.test(name));
}

// The packs named in A11Y_PACKS: package names, or paths from the lab's folder.
function named(env) {
    return String(env || '').split(',').map((s) => s.trim()).filter(Boolean)
        .map((s) => (s.startsWith('.') || path.isAbsolute(s) ? path.resolve(ROOT, s) : s));
}

/**
 * The packs to load: { names, packs }, each pack as the package exports it,
 * in the order named, once each.
 */
function loadPacks({ pkg = require(path.join(ROOT, 'package.json')), env = process.env.A11Y_PACKS, load = require, firstParty = FIRST_PARTY } = {}) {
    const names = [...new Set([...dependedOn(pkg), ...firstParty, ...named(env)])];
    const packs = [];
    for (const name of names) {
        try {
            const pack = load(name);
            if (pack && typeof pack === 'object' && !packs.includes(pack)) packs.push(pack);
        } catch {
            // Not installed, or broken: the lab runs without it.
        }
    }
    return { names, packs };
}

/**
 * What a pack's standard is, as the lab offers it: { key, name, package,
 * versions, profiles: [{ id, label, version, wcagVersion }] }, or null for a
 * pack with no standard (one of rules only).
 */
function describeStandard(pack) {
    const s = pack && pack.standard;
    if (!s || typeof s !== 'object' || typeof s.key !== 'string') return null;
    const name = typeof s.standard === 'string' && s.standard.trim() ? s.standard.trim() : s.key;
    const versions = Array.isArray(s.versions) ? s.versions.map(String) : [];
    const profiles = Object.entries(s.profiles && typeof s.profiles === 'object' ? s.profiles : {})
        .map(([id, p]) => ({
            id,
            label: `${name}${p && p.version ? ` ${p.version}` : ''}`,
            version: p && p.version ? String(p.version) : null,
            wcagVersion: p && p.wcagVersion ? String(p.wcagVersion) : null,
        }));
    // Two profiles of one version (the standard alone, and with WCAG, say)
    // would read the same: each then says its id.
    const repeated = new Set(profiles.map((p) => p.label).filter((l, i, all) => all.indexOf(l) !== i));
    for (const p of profiles) if (repeated.has(p.label)) p.label = `${p.label} (${p.id})`;
    return { key: s.key, name, package: pack.name || null, versions, profiles };
}

let loaded = null;

/**
 * Makes the standards' profiles ones a scan step can take: scan targets
 * (shared/conformance-targets.js) and options of the scan step's Profile
 * field, after the ones the lab lists itself. A profile already known is left
 * as it is. Returns the ids added.
 */
function registerProfiles(standards, {
    targets = require('../shared/conformance-targets.js'),
    actions = require('../workflow/action-definitions.js').ACTION_DEFINITIONS,
} = {}) {
    const added = targets.registerStandardProfiles(standards);
    const options = actions && actions.a11yScan && actions.a11yScan.fields && actions.a11yScan.fields.profile
        && actions.a11yScan.fields.profile.options;
    if (Array.isArray(options)) {
        for (const std of standards) {
            for (const p of std.profiles) {
                if (added.includes(p.id) && !options.some((o) => o && o.value === p.id)) options.push({ value: p.id, label: p.label, pack: true });
            }
        }
    }
    return added;
}

/** The installed packs, loaded once; their profiles become scan targets. */
function installedPacks() {
    if (!loaded) {
        loaded = loadPacks().packs;
        registerProfiles(loaded.map(describeStandard).filter(Boolean));
    }
    return loaded;
}

/**
 * A standard's requirements by version, from core's listProcedures, kept to
 * what the lab builds its rows from: { [version]: { key, standard, version,
 * requirements: [{ id, title, wcag }], groups } }. {} from a core without
 * test procedures.
 */
function listingsOf(pack, std, core) {
    if (!core || typeof core.listProcedures !== 'function') return {};
    const slimGroup = (g) => ({ id: g.id, title: g.title, requirements: g.requirements || [], groups: (g.groups || []).map(slimGroup) });
    const out = {};
    for (const version of std.versions) {
        try {
            const l = core.listProcedures({ packs: [pack], standard: std.key, version });
            if (!l) continue;
            out[version] = {
                key: std.key,
                standard: l.standard || std.name,
                version: l.version || version,
                requirements: (l.requirements || []).map((r) => ({ id: r.id, title: r.title, ...(r.wcag ? { wcag: r.wcag } : {}) })),
                groups: (l.groups || []).map(slimGroup),
            };
        } catch {
            // A version core cannot list is left out.
        }
    }
    return out;
}

// Core with the lab's procedures for what no rule evaluates
// (lab-procedures.js), so a standard's listings hold its every requirement.
function loadCore() {
    let core;
    try {
        core = require('@surea11y/core');
    } catch {
        return null;
    }
    return require('./lab-procedures').withLabProcedures(core);
}

/**
 * The installed packs' standards, each with its requirements by version
 * (`listings`) where core can list them.
 */
function installedStandards({ core = loadCore() } = {}) {
    return installedPacks().map((pack) => {
        const std = describeStandard(pack);
        return std ? { ...std, listings: listingsOf(pack, std, core) } : null;
    }).filter(Boolean);
}

/** The installed pack whose standard has `key`, or null. */
function packForStandard(key) {
    return installedPacks().find((p) => p && p.standard && p.standard.key === key) || null;
}

module.exports = { loadPacks, describeStandard, registerProfiles, installedPacks, installedStandards, packForStandard };
