'use strict';

/**
 * A manual rule: it finds what a person has to judge and asks about it. It
 * never fails; it returns cantTell with an occurrence per element to check,
 * or notApplicable when there is nothing to check.
 *
 * @check sample-new-window-review
 * @summary Links that open a new window say so
 * @applicability
 *   Every link with target="_blank".
 * @expectation
 *   A person checks that the link's text, or something next to it, says it
 *   opens a new window or tab.
 */

const id = 'sample-new-window-review';

const meta = {
  title: 'Links that open a new window say so',
  description: 'Lists the links that open a new window, for a person to check they say so.',
  i18n: {
    titleKey: 'sampleNewWindowReview_title',
    descriptionKey: 'sampleNewWindowReview_description'
  },
  tags: ['sample', 'links', 'atomic', 'manual'],
  wcagSc: [],
  defaultSeverity: 'minor',
  type: 'manual',
  defaultConfidence: 'medium',
  // The reason codes the rule gives, so definePack can check that `review`
  // names only these.
  reasonCodes: ['OPENS_NEW_WINDOW'],
  // How a person answers each question the rule asks, per reason code: a few
  // steps from the element the finding names, then what they see if it
  // passes and if it fails. In English; reports show it as "How to check".
  review: {
    OPENS_NEW_WINDOW: {
      steps: [
        'Find the link the report names on the page.',
        'Read its text, and any text or icon next to it.'
      ],
      passWhen: 'The link, or something next to it, says it opens a new window or tab.',
      failWhen:
        'Nothing says the link opens a new window or tab, so people are not warned before the change of context (best practice, WCAG technique G201).'
    }
  }
};

function runInPage(ctx) {
  const { helpers, rule } = ctx;
  // helpers.dom reads DOM properties and attributes in a way the page's
  // markup can't redirect (the lint rules in eslint.config.js ask for it).
  const { dom } = helpers;

  const links = helpers
    .queryAllSmart('a[href][target]')
    .filter((el) => String(dom.getAttribute(el, 'target') || '').toLowerCase() === '_blank');
  if (!links.length) {
    return { ruleId: rule.ruleId, outcome: 'notApplicable', severity: 'minor', occurrences: [] };
  }

  return {
    ruleId: rule.ruleId,
    outcome: 'cantTell',
    severity: rule.defaultSeverity,
    occurrences: links.map((el) =>
      helpers.reportOccurrence(el, {
        summary: 'This link opens a new window.',
        hint: 'Check that its text, or something next to it, says so.',
        i18n: {
          summaryKey: 'sampleNewWindowReview_summary',
          hintKey: 'sampleNewWindowReview_hint'
        },
        data: { details: { reasonCode: 'OPENS_NEW_WINDOW' } }
      })
    )
  };
}

module.exports = { id, meta, runInPage };
