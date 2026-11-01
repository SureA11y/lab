'use strict';

/**
 * An automatic rule of the pack's own: it decides, so it can fail.
 *
 * The header's @applicability, @expectation and @reports are what
 * `npm run docs` writes into docs/RULE_CATALOG.md for this rule.
 *
 * @check sample-link-text-specific
 * @summary Links don't say only "click here" or "read more"
 * @applicability
 *   Every link in the accessibility tree.
 * @expectation
 *   The link's accessible name is not only a generic phrase ("click
 *   here", "here", "read more", "more", "learn more"), whatever its case
 *   and spacing.
 * @reports
 *   - `name`: the link's accessible name, as the rule compared it.
 */

// Every id starts with the pack's namespace and "-".
const id = 'sample-link-text-specific';

const meta = {
  // English text, used when a dictionary has no message for the scan's locale.
  title: 'Links say where they go',
  description: 'Checks that no link is named only "click here", "read more" or the like.',
  // The keys of this rule's messages in i18n/<locale>.json.
  i18n: {
    titleKey: 'sampleLinkTextSpecific_title',
    descriptionKey: 'sampleLinkTextSpecific_description'
  },
  // The namespace tag makes the rule opt-in: it runs under the pack's
  // profiles, or when a scan asks for it by id or by that tag.
  tags: ['sample', 'links', 'atomic', 'automatic'],
  // WCAG 2.4.4 asks for a link's purpose from its text or its context; this
  // rule is stricter (the text alone), so it maps to no criterion.
  wcagSc: [],
  defaultSeverity: 'moderate',
  type: 'automatic',
  defaultConfidence: 'high'
};

// The engine runs this function in the page (in a browser, it writes it into
// the page), so it uses only `ctx`: no variable or module from outside it.
function runInPage(ctx) {
  const { helpers, rule } = ctx;
  const GENERIC = ['click here', 'here', 'read more', 'more', 'learn more'];

  // Core's helpers (docs/RULE_HELPERS.md in @surea11y/core): queryAllSmart
  // finds elements in the scanned part of the page, shadow roots included.
  const links = helpers.queryAllSmart('a[href]').filter((el) => {
    const included = helpers.isIncludedInAccessibilityTree(el, ctx);
    return typeof included === 'boolean' ? included : !!(included && included.eligible);
  });
  if (!links.length) {
    return { ruleId: rule.ruleId, outcome: 'notApplicable', severity: 'minor', occurrences: [] };
  }

  const occurrences = [];
  for (const el of links) {
    // Its name from aria-labelledby, aria-label or title, else its content.
    const author = helpers.getAccessibleNameInfo(el, ctx);
    const content = helpers.getContentNameInfo(el, ctx);
    const name = String((author && author.value) || (content && content.value) || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
    if (GENERIC.includes(name)) {
      // reportOccurrence attaches the element; the engine fills in its
      // selector, its HTML and where it is.
      occurrences.push(
        helpers.reportOccurrence(el, {
          summary: `The link is named only "${name}".`,
          hint: 'Name the link by where it goes, or add that to its name.',
          i18n: {
            summaryKey: 'sampleLinkTextSpecific_summary_fail',
            hintKey: 'sampleLinkTextSpecific_hint_fail',
            params: { name }
          },
          // reasonCode is part of a finding's identity in baselines and SARIF:
          // keep it stable once the pack is released.
          data: { details: { reasonCode: 'GENERIC_LINK_NAME', name } }
        })
      );
    }
  }

  return occurrences.length
    ? { ruleId: rule.ruleId, outcome: 'fail', severity: rule.defaultSeverity, occurrences }
    : { ruleId: rule.ruleId, outcome: 'pass', severity: 'minor', occurrences: [] };
}

module.exports = { id, meta, runInPage };
