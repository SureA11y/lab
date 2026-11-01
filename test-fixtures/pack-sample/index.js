'use strict';

/**
 * Sample Standard: a standard for @surea11y/core, with requirements of its own.
 *
 * requirements.js holds the standard's requirements and rule-map.js the rules
 * that check each one; ruleMappedStandard turns them into what the engine
 * needs: the requirements each result names, a rollup per requirement, and
 * checks of the two tables. procedures.js says how a person assesses each
 * requirement by hand. Pass the pack to a scan and name a profile:
 *
 *   runDomRulesInPage(url, null, { packs: [pack], profile: 'sample-1.0' })
 */

const { definePack, ruleMappedStandard } = require('@surea11y/core/pack');
const { name, version } = require('./package.json');
const { VERSIONS, REQUIREMENTS } = require('./requirements');
const { RULE_REQUIREMENTS } = require('./rule-map');
const { PROCEDURES, GROUPS } = require('./procedures');

const NAMESPACE = 'sample';
const STANDARD = 'Sample Standard';

// The WCAG version a version of the standard is built on (requirements.js).
const wcagVersionOf = (v) => VERSIONS.find((x) => x.version === v).wcagVersion;

const { mappingsFor, composites, validate, wcagTagsOf } = ruleMappedStandard({
  standard: STANDARD,
  tag: NAMESPACE,
  versions: VERSIONS,
  requirements: REQUIREMENTS,
  ruleMap: RULE_REQUIREMENTS
});

module.exports = definePack({
  name,
  version,
  namespace: NAMESPACE, // every rule, rollup and profile id starts with "sample-"
  core: '^1.14.1', // the core versions the pack works with

  // The pack's own rules, one module each. A variant of a core rule (from:)
  // is listed here too.
  rules: [
    require('./rules/automatic/sample-link-text-specific'),
    require('./rules/automatic/sample-contrast-enhanced'),
    require('./rules/manual/sample-new-window-review')
  ],

  standard: {
    key: NAMESPACE, // engineOptions.mappings: ['sample'] names its requirements on results
    standard: STANDARD,
    versions: VERSIONS.map((v) => v.version),
    // What a scan runs under each profile. `mappedRules` runs every rule
    // rule-map.js lists for the version; `tags` selects more by tag, `rules`
    // adds rules by id, `exclude` leaves rules out and `severity` gives a rule
    // another severity. `wcagVersion` is the WCAG version its scans are judged
    // by, which a profile with no WCAG tag has nothing else to say.
    profiles: {
      // Exactly the standard: the rules rule-map.js lists, and the pack's own,
      // judged by the WCAG version the standard is built on.
      'sample-1.0': {
        version: '1.0',
        tags: [NAMESPACE],
        mappedRules: true,
        wcagVersion: wcagVersionOf('1.0'),
        severity: { 'img-alt-present': 'critical' }
      },
      // The standard on top of WCAG 2.2 A and AA, with core's best-practice
      // region rule; core's 4.5:1 contrast gives way to the 7:1 variant.
      'sample-1.0-wcag': {
        version: '1.0',
        tags: wcagTagsOf('1.0').concat([NAMESPACE]),
        mappedRules: true,
        rules: ['region'],
        exclude: { rules: ['contrast-minimum'] }
      }
    },
    // The tag of the pack's own rules: they run only when the standard is asked for.
    ruleTag: NAMESPACE,
    ruleMapped: true,
    mappingsFor,
    composites,
    validate,
    // How a person assesses each requirement by hand (proceduresFor), from
    // procedures.js. A standard whose requirements all restate WCAG criteria
    // one for one can pass applicability: 'wcag' to ruleMappedStandard and
    // use the procedures it returns instead.
    procedures: PROCEDURES,
    // How the standard groups its requirements, as a list of their procedures
    // shows them (listProcedures).
    groups: GROUPS,
    // The note above the standard's results in the HTML report.
    report: { noteKey: 'sample_report_note' }
  },

  // The rules' messages, per locale. A locale with no dictionary shows them
  // in English.
  dictionaries: { en: require('./i18n/en.json') }
});
