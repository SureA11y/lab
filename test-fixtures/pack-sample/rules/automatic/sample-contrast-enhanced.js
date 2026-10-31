'use strict';

/**
 * A variant of a core rule: core's contrast-minimum, run at other
 * thresholds. It has no code of its own: the engine runs the core rule's,
 * with `config` as its settings, so a fix to the core rule reaches it.
 * A core rule that can be run this way declares its `settings`
 * (contrast-minimum: normalTextRatio, largeTextRatio, boldLargeMinPx).
 *
 * @check sample-contrast-enhanced
 * @summary Text reaches a contrast ratio of 7:1 (4.5:1 for large text)
 * @applicability
 *   As core's contrast-minimum: visible text whose colours the engine can
 *   resolve.
 * @expectation
 *   As contrast-minimum, at 7:1 for normal text and 4.5:1 for large text.
 */

const id = 'sample-contrast-enhanced';

// The core rule it runs, and the settings it runs it with.
const from = 'contrast-minimum';
const config = { normalTextRatio: 7, largeTextRatio: 4.5 };

const meta = {
  title: 'Text reaches a contrast ratio of 7:1',
  description: 'Checks text contrast at 7:1, or 4.5:1 for large text.',
  i18n: {
    titleKey: 'sampleContrastEnhanced_title',
    descriptionKey: 'sampleContrastEnhanced_description'
  },
  tags: ['sample', 'color', 'atomic', 'automatic'],
  wcagSc: [],
  defaultSeverity: 'serious',
  type: 'automatic',
  defaultConfidence: 'high'
};

module.exports = { id, from, config, meta };
