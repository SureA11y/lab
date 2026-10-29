'use strict';

// The server keeps only a run's latest screenshots in its progress log
// (src/server-side/progress-log.js); older entries arrive with
// extra.screenshotDropped and no image. Their live cards must still appear,
// flagged, rather than vanish: a screenshot step replayed late would otherwise
// leave a gap in the live view.

const {test, describe} = require('node:test');
const assert = require('node:assert/strict');

let createProgressProcessor;

test('load the module under test', async () => {
    ({createProgressProcessor} = await import('./progress-processor.js'));
});

function harness() {
    const cards = [];
    const processor = createProgressProcessor({
        liveVarState: {vars: Object.create(null)},
        liveStepState: {counter: null},
        appendLog: () => {},
        addStreamCard: (card) => cards.push(card),
        addScanTotals: () => {},
        getUseLiveStream: () => true,
    });
    return {processor, cards};
}

describe('entries whose screenshot the server dropped', () => {
    test('a screenshot step still gets its card, without an image and flagged', () => {
        const {processor, cards} = harness();
        processor.processOne({type: 'screenshot', message: 'screenshot', extra: {caption: 'Home', screenshotDropped: true}});
        assert.equal(cards.length, 1);
        assert.equal(cards[0].kind, 'screenshot');
        assert.equal(cards[0].previewUrl, null);
        assert.equal(cards[0].screenshotDropped, true);
    });

    test('a scan card is flagged too; one that kept its image is not', () => {
        const {processor, cards} = harness();
        processor.processOne({type: 'scan', message: 'a11yScan ready', extra: {label: 'old', screenshotDropped: true}});
        processor.processOne({type: 'scan', message: 'a11yScan ready', extra: {label: 'new', dataUrl: 'data:image/jpeg;base64,AA'}});
        assert.deepEqual(cards.map((c) => [c.label, c.previewUrl, c.screenshotDropped]), [
            ['old', null, true],
            ['new', 'data:image/jpeg;base64,AA', false],
        ]);
    });

    test('a screenshot entry with neither image nor flag still makes no card, as before', () => {
        const {processor, cards} = harness();
        processor.processOne({type: 'screenshot', message: 'screenshot', extra: {caption: 'x'}});
        assert.equal(cards.length, 0);
    });
});
