'use strict';

/**
 * report-scan.js (shared)
 *
 * What a report's scan checked against, read the same way from every report,
 * whichever format it was saved in.
 *
 * A scan records it as two fields (report version 2):
 *   profile: { id, label }  what it checked against: a standard when one was
 *                           applied ("en301549-v4.1.1", "EN 301 549 V4.1.1"), otherwise
 *                           its WCAG 2.2 level as a profile ("wcag22-aa").
 *   wcag:    { version, level }  the WCAG version and level that came to.
 *
 * A scan of several profiles at once also records
 *   profiles:       [{ id, label }]  every profile it checked against, in the
 *                   order they ran, the WCAG level first; `profile` is then
 *                   the first standard among them (or the WCAG level, when
 *                   there is none), so a reader that knows one profile still
 *                   finds the standard.
 *   profilesNotRun: [{ id, label, reason }]  the ones asked for that did not
 *                   run, when any did not.
 * A scan of one profile records neither.
 *
 * Reports saved before (version 1, unversioned) recorded wcagLevel,
 * wcagVersion and conformanceProfile (the standard, or null for plain WCAG).
 * Every reader goes through these accessors, so both kinds read alike: a
 * saved report keeps showing what it checked against, and still compares with
 * a new run.
 *
 * Browser: available as globalThis.A11Y_REPORT_SCAN.
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_REPORT_SCAN = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const LEVELS = ['A', 'AA', 'AAA'];
    const WCAG_PROFILE = /^wcag22-a{1,3}$/i;

    function str(v) {
        return typeof v === 'string' && v.trim() ? v.trim() : null;
    }

    function levelOf(v) {
        const level = str(v) ? v.trim().toUpperCase() : null;
        return LEVELS.includes(level) ? level : null;
    }

    /** The WCAG version and level a scan came to: { version, level }, either may be null. */
    function scanWcag(scan) {
        const s = scan && typeof scan === 'object' ? scan : {};
        if (s.wcag && typeof s.wcag === 'object') {
            return { version: str(s.wcag.version), level: levelOf(s.wcag.level) };
        }
        return { version: str(s.wcagVersion), level: levelOf(s.wcagLevel) };
    }

    /** The profile id and label for WCAG at a version and level, as a scan names it. */
    function wcagProfile({ version, level } = {}) {
        if (!level) return null;
        if (!version || version === '2.2') return { id: `wcag22-${level.toLowerCase()}`, label: `WCAG 2.2 ${level}` };
        // Older reports could check another version, which no profile is.
        return { id: null, label: `WCAG ${version} ${level}` };
    }

    /**
     * What a scan checked against: { id, label }, or null when the report
     * does not say. A standard when one was applied, else its WCAG level.
     */
    function scanProfile(scan) {
        const s = scan && typeof scan === 'object' ? scan : {};
        if (s.profile && typeof s.profile === 'object' && (str(s.profile.id) || str(s.profile.label))) {
            return { id: str(s.profile.id), label: str(s.profile.label) || str(s.profile.id) };
        }
        const standard = s.conformanceProfile;
        if (standard && typeof standard === 'object' && str(standard.id)) {
            return { id: str(standard.id), label: str(standard.label) || str(standard.id) };
        }
        return wcagProfile(scanWcag(s));
    }

    /** The standard a scan checked against ("rgaa-4.1.2"), or null for plain WCAG. */
    function scanStandardId(scan) {
        const profile = scanProfile(scan);
        const id = profile && profile.id;
        return id && !WCAG_PROFILE.test(id) ? id : null;
    }

    function profileEntries(list, { reason = false } = {}) {
        const out = [];
        for (const p of Array.isArray(list) ? list : []) {
            const id = p && typeof p === 'object' ? str(p.id) : null;
            if (!id || out.some((x) => x.id === id)) continue;
            const entry = { id, label: str(p.label) || id };
            if (reason) entry.reason = str(p.reason);
            out.push(entry);
        }
        return out;
    }

    /**
     * Every profile a scan checked against, [{ id, label }], in the order they
     * ran: its `profiles` for a scan of several, else its one profile. [] when
     * the report does not say.
     */
    function scanProfiles(scan) {
        const s = scan && typeof scan === 'object' ? scan : {};
        const several = profileEntries(s.profiles);
        if (several.length > 1) return several;
        const one = scanProfile(s);
        return one ? [one] : [];
    }

    /** The profiles asked for that did not run, [{ id, label, reason }]. */
    function scanProfilesNotRun(scan) {
        return profileEntries(scan && scan.profilesNotRun, { reason: true });
    }

    /** What a scan checked against, named: "WCAG 2.2 AA + WAI-ARIA 1.2". */
    function scanProfilesLabel(scan) {
        const list = scanProfiles(scan);
        return list.length ? list.map((p) => p.label).join(' + ') : null;
    }

    /** The standards a scan checked against (not its WCAG level), ids in order. */
    function scanStandardIds(scan) {
        return scanProfiles(scan).map((p) => p.id).filter((id) => id && !WCAG_PROFILE.test(id));
    }

    /**
     * Whether two scans checked against the same profiles, in whatever
     * order: the same standards, and the same WCAG level.
     */
    function sameProfiles(a, b) {
        const key = (scan) => scanProfiles(scan).map((p) => p.id || p.label).sort().join('|');
        return key(a) === key(b);
    }

    /**
     * The fields a scan of the current format records, from what it was
     * checked against: `standard` the applied standard ({ id, label }) or
     * null, and the WCAG version and level it came to. `profiles`, for a scan
     * of several, every one that ran ({ id, label }), and `profilesNotRun`
     * those that did not.
     */
    function scanProfileFields({ standard = null, version = null, level = null, profiles = null, profilesNotRun = null } = {}) {
        const wcag = { version: str(version), level: levelOf(level) };
        const list = profileEntries(profiles);
        let profile = standard && str(standard.id)
            ? { id: str(standard.id), label: str(standard.label) || str(standard.id) }
            : wcagProfile(wcag);
        const out = { profile, wcag };
        if (list.length > 1) {
            profile = list.find((p) => !WCAG_PROFILE.test(p.id)) || list[0];
            out.profile = profile;
            out.profiles = list;
        }
        const notRun = profileEntries(profilesNotRun, { reason: true });
        if (notRun.length) out.profilesNotRun = notRun;
        return out;
    }

    /** A scan's `profile` and `wcag`, as the current format records them, from either format. */
    function scanFields(scan) {
        const out = { profile: scanProfile(scan), wcag: scanWcag(scan) };
        const several = profileEntries(scan && scan.profiles);
        if (several.length > 1) out.profiles = several;
        const notRun = scanProfilesNotRun(scan);
        if (notRun.length) out.profilesNotRun = notRun;
        return out;
    }

    const OLD_FIELDS = ['wcagLevel', 'wcagVersion', 'conformanceProfile'];

    /**
     * Brings a scan saved in the older format to the current one, in place:
     * its wcagLevel, wcagVersion and conformanceProfile become `profile` and
     * `wcag`, which a scan that recorded none of them gets too, saying it does
     * not know (null). A scan already in the current format is left as it is.
     */
    function upgradeScanFields(scan) {
        if (!scan || typeof scan !== 'object') return scan;
        const current = 'profile' in scan && 'wcag' in scan;
        if (current && !OLD_FIELDS.some((k) => k in scan)) return scan;
        if (!scan.wcag || typeof scan.wcag !== 'object') scan.wcag = scanWcag(scan);
        if (!scan.profile || typeof scan.profile !== 'object') scan.profile = scanProfile(scan);
        for (const k of OLD_FIELDS) delete scan[k];
        return scan;
    }

    return {
        WCAG_PROFILE,
        upgradeScanFields,
        scanWcag,
        scanProfile,
        scanStandardId,
        scanStandardIds,
        scanProfiles,
        scanProfilesNotRun,
        scanProfilesLabel,
        sameProfiles,
        scanProfileFields,
        scanFields,
    };
}));
