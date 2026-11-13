'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');
const runSpec = require('./run-spec.js');
const { checkAgainstSchema } = require('./json-schema-check.js');
const { buildRunSpecSchema, checkSpecActions, specFileNote, VAR_TOKEN_PATTERN } = require('./run-spec-schema.js');
const { VIEWPORT_PRESETS } = require('./scan-inputs.js');
const { SCAN_TARGETS } = require('./conformance-targets.js');

const schema = buildRunSpecSchema({
    actionDefinitions: ACTION_DEFINITIONS,
    profiles: Object.keys(SCAN_TARGETS),
    defaultProfile: runSpec.DEFAULT_PROFILE,
    viewportPresets: Object.keys(VIEWPORT_PRESETS),
    varNamePattern: runSpec.VAR_NAME_RE.source,
});

function check(actions, customSteps) {
    return checkSpecActions(
        { type: 'a11y-run-spec', specVersion: 1, actions, ...(customSteps ? { customSteps } : {}) },
        { schema, checkAgainstSchema }
    );
}

// Keywords json-schema-check.js acts on, and the ones that only annotate. A
// keyword outside both would be published without anything here checking it.
const CHECKED = new Set([
    'type', 'enum', 'const', 'pattern', 'minLength', 'minimum', 'maximum', 'minItems', 'required',
    'properties', 'additionalProperties', 'propertyNames', 'items', 'anyOf', 'allOf',
    'if', 'then', '$ref', '$defs',
]);
const ANNOTATIONS = new Set([
    '$schema', '$id', 'title', 'description', 'default', 'examples', 'deprecated', 'format',
]);

describe('buildRunSpecSchema', () => {
    test('has a step schema for every action type, and a field for every field', () => {
        for (const [type, def] of Object.entries(ACTION_DEFINITIONS)) {
            const step = schema.$defs[`action.${type}`];
            assert.ok(step, `no schema for ${type}`);
            for (const name of Object.keys(def.fields || {})) {
                assert.ok(step.properties[name], `${type}.${name} is missing from the schema`);
            }
        }
    });

    test('a switch case is not a step on its own', () => {
        assert.ok(!schema.$defs.action.properties.type.enum.includes('case'));
        assert.deepEqual(schema.$defs['action.switch'].properties.cases.items, { $ref: '#/$defs/action.case' });
    });

    test('names the same top-level fields normalizeRunSpec reads', () => {
        assert.deepEqual(Object.keys(schema.properties).sort(), runSpec.KNOWN_SPEC_KEYS.slice().sort());
    });

    test('uses only keywords the checker knows', () => {
        const unknown = new Set();
        const walk = (node, inProperties) => {
            if (Array.isArray(node)) return node.forEach((n) => walk(n, false));
            if (!node || typeof node !== 'object') return;
            for (const [key, value] of Object.entries(node)) {
                // Inside properties and $defs the keys are names, not keywords.
                if (!inProperties && !CHECKED.has(key) && !ANNOTATIONS.has(key)) unknown.add(key);
                if (key === 'default' || key === 'examples' || key === 'enum' || key === 'const') continue;
                walk(value, key === 'properties' || key === '$defs');
            }
        };
        walk(schema, false);
        assert.deepEqual([...unknown], []);
    });

    test('the token pattern finds the tokens the engine interpolates', () => {
        const re = new RegExp(VAR_TOKEN_PATTERN);
        for (const text of ['{var:count}', 'Page {var: name}', '{index}', 'Item {oneBased} of {total}', '{VAR:x}']) {
            assert.ok(re.test(text), text);
        }
        assert.ok(!re.test('{not a token}'));
    });
});

describe('the examples the action definitions show', () => {
    // These reach docs/step-definitions.html, the contract and the app's
    // help: a wrong one teaches a step that does not run.
    test('are valid steps', () => {
        const problems = [];
        for (const [type, def] of Object.entries(ACTION_DEFINITIONS)) {
            const snippets = (def.examples || []).map((e) => e.snippet);
            for (const field of Object.values(def.fields || {})) {
                if (field.type === 'Action[]' && Array.isArray(field.placeholder)) snippets.push(...field.placeholder);
            }
            for (const snippet of snippets) {
                // A step that only lives in another's list is checked as itself.
                const ref = snippet.type === 'case' || snippet.type === 'slotSteps' ? `#/$defs/action.${snippet.type}` : '#/$defs/action';
                for (const p of checkAgainstSchema({ $ref: ref }, snippet, { root: schema })) {
                    problems.push(`${type}: ${JSON.stringify(snippet).slice(0, 80)} ${p.path} ${p.message}`);
                }
            }
        }
        assert.deepEqual(problems, []);
    });
});

describe('checkSpecActions', () => {
    test('a valid spec has nothing to report', () => {
        const { errors, warnings } = check([
            { type: 'navigate', url: 'https://example.com/{var:path}' },
            { type: 'wait', ms: 500 },
            { type: 'wait', ms: '{var:pause}' },
            { type: 'wait', ms: '250' },
            { type: 'setViewport', preset: 'mobile', zoom: '2' },
            { type: 'click', selector: '#go', programmatic: true, disabled: true },
            { type: 'a11yScan', label: 'Home', profile: 'wcag22-aa' },
        ]);
        assert.deepEqual(errors, []);
        assert.deepEqual(warnings, []);
    });

    test('a value of the wrong kind is an error, since the engine reads it as absent', () => {
        // A boolean field only takes true, never the text "true".
        const { errors } = check([
            { type: 'click', selector: '#a', programmatic: 'true' },
            { type: 'click', selector: '#b', optional: 'true' },
            { type: 'wait', ms: 'soon' },
        ]);
        assert.equal(errors.length, 3);
        assert.match(errors[0], /^\$\.actions\[0\]\.programmatic must be true or false/);
        assert.match(errors[1], /^\$\.actions\[1\]\.optional must be true or false/);
        assert.match(errors[2], /^\$\.actions\[2\]\.ms must be a number/);
    });

    test('a missing required field is an error, inside nested steps too', () => {
        const { errors } = check([{ type: 'group', actions: [{ type: 'navigate' }] }]);
        assert.deepEqual(errors, ['$.actions[0].actions[0] needs "url"']);
    });

    test('a step type the engine does not have is an error, since the run would fail at it', () => {
        const { errors, warnings } = check([{ type: 'save' }, { type: 'case', comparison: 'equals' }]);
        assert.equal(errors.length, 2);
        assert.match(errors[0], /^\$\.actions\[0\]\.type "save" is not a step type/);
        assert.deepEqual(warnings, []);
    });

    test('an undeclared field and an unlisted value are warnings, since the run goes on', () => {
        const { errors, warnings } = check([
            { type: 'screenshot', name: 'home' },
            { type: 'navigate', url: 'https://example.com', waitUntil: 'networkidle2' },
        ]);
        assert.deepEqual(errors, []);
        assert.equal(warnings.length, 2);
        assert.match(warnings[0], /\$\.actions\[0\]\.name "name" is not a known field/);
        assert.match(warnings[1], /\$\.actions\[1\]\.waitUntil must be one of/);
    });

    test('any zoom factor is accepted, not only the offered ones', () => {
        const { errors, warnings } = check([{ type: 'setViewport', zoom: '1.5' }]);
        assert.deepEqual(errors, []);
        assert.deepEqual(warnings, []);
    });

    test('a secret may be left out when the step says it was masked', () => {
        assert.deepEqual(check([{ type: 'setPassword', selector: '#p', valueMasked: true }]).errors, []);
        const { errors } = check([{ type: 'setPassword', selector: '#p' }]);
        assert.equal(errors.length, 1);
        assert.match(errors[0], /"value", or an object with "valueMasked"/);
    });

    test('a call to a custom step the spec does not have is an error, a token is left alone', () => {
        const customSteps = [{ id: 'scan', actions: [{ type: 'a11yScan' }] }];
        const { errors } = check([
            { type: 'runCustomStep', customStepId: 'scan' },
            { type: 'runCustomStep', customStepId: 'scna' },
            { type: 'runCustomStep', customStepId: '{var:which}' },
        ], customSteps);
        assert.deepEqual(errors, ['$.actions[1].customStepId "scna" names no custom step in this spec (it has "scan")']);
    });

    test('calls inside custom steps are checked too', () => {
        const customSteps = [
            { id: 'outer', actions: [{ type: 'runCustomStep', customStepId: 'inner' }] },
        ];
        const { errors } = check([{ type: 'runCustomStep', customStepId: 'outer' }], customSteps);
        assert.deepEqual(errors, ['$.customSteps[0].actions[0].customStepId "inner" names no custom step in this spec (it has "outer")']);
    });

    test('argsJson may be the object itself, not only its JSON text', () => {
        const customSteps = [{ id: 'login', inputs: ['user'], actions: [] }];
        const { errors, warnings } = check([{ type: 'runCustomStep', customStepId: 'login', argsJson: { user: 'ana' } }], customSteps);
        assert.deepEqual({ errors, warnings }, { errors: [], warnings: [] });
    });

    test('duplicate custom step ids and bad argsJson are errors', () => {
        const customSteps = [
            { id: 'a', actions: [] },
            { id: 'a', actions: [] },
        ];
        const { errors } = check([
            { type: 'runCustomStep', customStepId: 'a', argsJson: '{"x": 1' },
            { type: 'runCustomStep', customStepId: 'a', argsJson: '[1]' },
            { type: 'runCustomStep', customStepId: 'a', argsJson: '{"x": 1}' },
        ], customSteps);
        assert.equal(errors.length, 3);
        assert.match(errors[0], /customSteps\[1\]\.id "a" is used by an earlier custom step/);
        assert.match(errors[1], /actions\[0\]\.argsJson is not valid JSON/);
        assert.match(errors[2], /actions\[1\]\.argsJson must be a JSON object/);
    });

    test('a spec file without its type and version gets a note, separate from its steps', () => {
        assert.match(specFileNote({ actions: [] }), /"type": "a11y-run-spec"/);
        assert.equal(specFileNote({ type: 'a11y-run-spec', specVersion: 1 }), null);
        assert.deepEqual(checkSpecActions({ actions: [{ type: 'a11yScan' }] }, { schema, checkAgainstSchema }).warnings, []);
    });

    test('leaves an empty or missing list of steps to normalizeRunSpec', () => {
        assert.deepEqual(check([]).errors, []);
        assert.deepEqual(checkSpecActions({ type: 'a11y-run-spec', specVersion: 1 }, { schema, checkAgainstSchema }).errors, []);
    });
});
