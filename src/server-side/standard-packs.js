'use strict';

// The standards the lab knows besides WCAG: those of the installed packs for
// surea11y core. Every @surea11y/pack-* package the lab depends on is tried,
// and any named in A11Y_PACKS (comma-separated package names or paths); a
// pack that does not load is left out. Each one's standard (its key, name,
// versions and profiles) comes from the pack itself, so a new standard needs
// no code of the lab's own: install its pack.

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PACK_NAME = /^@surea11y\/pack-[a-z0-9-]+$/;

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
function loadPacks({ pkg = require(path.join(ROOT, 'package.json')), env = process.env.A11Y_PACKS, load = require } = {}) {
    const names = [...new Set([...dependedOn(pkg), ...named(env)])];
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
    return { key: s.key, name, package: pack.name || null, versions, profiles };
}

let loaded = null;

/** The installed packs, loaded once. */
function installedPacks() {
    if (!loaded) loaded = loadPacks().packs;
    return loaded;
}

/** The installed packs' standards. */
function installedStandards() {
    return installedPacks().map(describeStandard).filter(Boolean);
}

/** The installed pack whose standard has `key`, or null. */
function packForStandard(key) {
    return installedPacks().find((p) => p && p.standard && p.standard.key === key) || null;
}

module.exports = { loadPacks, describeStandard, installedPacks, installedStandards, packForStandard };
