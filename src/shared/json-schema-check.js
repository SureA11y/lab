'use strict';

/**
 * json-schema-check.js (shared)
 *
 * Checks a value against the part of JSON Schema (2020-12) that the published
 * schemas in schemas/ use: type, enum, const, pattern, minLength, minimum,
 * maximum, minItems, required, properties, additionalProperties, propertyNames, items,
 * anyOf, allOf, if/then and local $ref ("#/$defs/name"). Anything else in a
 * schema is ignored rather than guessed at, so a schema that grows a keyword
 * this does not know has to grow it here too, and its tests say so.
 *
 * Every problem is reported, not just the first, each with a path a person can
 * find in the file ("$.actions[2].selector") and the keyword that failed, so a
 * caller can decide which ones are errors and which are warnings. An enum
 * problem also carries the value that failed.
 *
 * Browser: available as globalThis.A11Y_JSON_SCHEMA_CHECK.
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_JSON_SCHEMA_CHECK = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const TYPE_NAMES = {
        string: 'text',
        number: 'a number',
        integer: 'a whole number',
        boolean: 'true or false',
        object: 'an object',
        array: 'a list',
        null: 'null',
    };

    function isPlainObject(v) {
        return !!v && typeof v === 'object' && !Array.isArray(v);
    }

    function hasType(value, type) {
        switch (type) {
            case 'string': return typeof value === 'string';
            case 'number': return typeof value === 'number' && Number.isFinite(value);
            case 'integer': return Number.isInteger(value);
            case 'boolean': return typeof value === 'boolean';
            case 'object': return isPlainObject(value);
            case 'array': return Array.isArray(value);
            case 'null': return value === null;
            default: return true;
        }
    }

    function sameValue(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    function show(value) {
        return JSON.stringify(value);
    }

    function joinPath(path, key) {
        if (typeof key === 'number') return `${path}[${key}]`;
        return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${show(key)}]`;
    }

    /** A short reading of what a schema accepts, for anyOf messages. */
    function describe(schema, root) {
        const s = resolve(schema, root);
        if (!isPlainObject(s)) return 'anything';
        if (Array.isArray(s.enum)) return `one of ${s.enum.map(show).join(', ')}`;
        if ('const' in s) return show(s.const);
        if (typeof s.pattern === 'string' && s.description) return s.description;
        const types = Array.isArray(s.type) ? s.type : (s.type ? [s.type] : []);
        if (types.length) return types.map((t) => TYPE_NAMES[t] || t).join(' or ');
        if (Array.isArray(s.anyOf)) return s.anyOf.map((b) => describe(b, root)).join(' or ');
        if (Array.isArray(s.required)) return `an object with ${s.required.map((n) => `"${n}"`).join(' and ')}`;
        return 'a different value';
    }

    function resolve(schema, root) {
        if (!isPlainObject(schema) || typeof schema.$ref !== 'string') return schema;
        const match = /^#\/\$defs\/(.+)$/.exec(schema.$ref);
        const target = match && root && isPlainObject(root.$defs) ? root.$defs[match[1]] : null;
        if (!target) throw new Error(`Unresolvable $ref ${schema.$ref}`);
        return target;
    }

    /** True when the value passes, without collecting anything. */
    function passes(schema, value, root) {
        const problems = [];
        walk(schema, value, '$', root, problems);
        return problems.length === 0;
    }

    function walk(schemaIn, value, path, root, problems) {
        const schema = resolve(schemaIn, root);
        if (schema === true || schema === undefined) return;
        if (schema === false) {
            problems.push({ path, keyword: 'false', message: 'is not allowed' });
            return;
        }
        if (!isPlainObject(schema)) return;

        if (schema.type !== undefined) {
            const types = Array.isArray(schema.type) ? schema.type : [schema.type];
            if (!types.some((t) => hasType(value, t))) {
                problems.push({
                    path,
                    keyword: 'type',
                    message: `must be ${types.map((t) => TYPE_NAMES[t] || t).join(' or ')}, not ${show(value)}`,
                });
                // The rest of the keywords describe a value of the right type.
                return;
            }
        }

        if ('const' in schema && !sameValue(schema.const, value)) {
            problems.push({ path, keyword: 'const', message: `must be ${show(schema.const)}` });
        }

        if (Array.isArray(schema.enum) && !schema.enum.some((e) => sameValue(e, value))) {
            problems.push({ path, keyword: 'enum', value, message: `must be one of ${schema.enum.map(show).join(', ')}, not ${show(value)}` });
        }

        if (typeof value === 'string') {
            if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
                problems.push({ path, keyword: 'minLength', message: schema.minLength === 1 ? 'must not be empty' : `must be at least ${schema.minLength} characters` });
            }
            if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
                problems.push({ path, keyword: 'pattern', message: `must be ${schema.description || `text matching ${schema.pattern}`}` });
            }
        }

        if (typeof value === 'number' && typeof schema.minimum === 'number' && value < schema.minimum) {
            problems.push({ path, keyword: 'minimum', message: `must be at least ${schema.minimum}` });
        }
        if (typeof value === 'number' && typeof schema.maximum === 'number' && value > schema.maximum) {
            problems.push({ path, keyword: 'maximum', message: `must be at most ${schema.maximum}` });
        }

        if (Array.isArray(value)) {
            if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
                problems.push({ path, keyword: 'minItems', message: schema.minItems === 1 ? 'must not be empty' : `must have at least ${schema.minItems} items` });
            }
            if (schema.items !== undefined) {
                value.forEach((item, i) => walk(schema.items, item, joinPath(path, i), root, problems));
            }
        }

        if (isPlainObject(value)) {
            const props = isPlainObject(schema.properties) ? schema.properties : {};
            for (const name of Array.isArray(schema.required) ? schema.required : []) {
                if (value[name] === undefined || !Object.prototype.hasOwnProperty.call(value, name)) {
                    problems.push({ path, keyword: 'required', message: `needs "${name}"` });
                }
            }
            for (const [name, child] of Object.entries(value)) {
                // A field set to undefined is one JSON leaves out: an object
                // built in memory reads as the file it would be saved as.
                if (child === undefined) continue;
                const childPath = joinPath(path, name);
                if (isPlainObject(schema.propertyNames) || typeof schema.propertyNames === 'boolean') {
                    const nameProblems = [];
                    walk(schema.propertyNames, name, childPath, root, nameProblems);
                    if (nameProblems.length) {
                        problems.push({ path: childPath, keyword: 'propertyNames', message: `"${name}" ${nameProblems[0].message}` });
                    }
                }
                if (Object.prototype.hasOwnProperty.call(props, name)) {
                    walk(props[name], child, childPath, root, problems);
                } else if (schema.additionalProperties === false) {
                    problems.push({ path: childPath, keyword: 'additionalProperties', message: `"${name}" is not a known field` });
                } else if (isPlainObject(schema.additionalProperties)) {
                    walk(schema.additionalProperties, child, childPath, root, problems);
                }
            }
        }

        if (Array.isArray(schema.allOf)) {
            for (const part of schema.allOf) walk(part, value, path, root, problems);
        }

        if (Array.isArray(schema.anyOf) && !schema.anyOf.some((branch) => passes(branch, value, root))) {
            // A list of allowed values with a token as the way out reads as a
            // value problem, which callers may treat more leniently than a
            // value of the wrong kind.
            // A list of such values (a scan's profiles) reads the same.
            const valuesOnly = (b) => {
                const r = resolve(b, root);
                if (!isPlainObject(r)) return false;
                if (Array.isArray(r.enum) || typeof r.pattern === 'string') return true;
                if (Array.isArray(r.anyOf)) return r.anyOf.every(valuesOnly);
                return r.type === 'array' && isPlainObject(r.items) && valuesOnly(r.items);
            };
            const onlyValues = schema.anyOf.every(valuesOnly);
            problems.push({
                path,
                keyword: onlyValues ? 'enum' : 'anyOf',
                message: `must be ${schema.anyOf.map((b) => describe(b, root)).join(', or ')}, not ${show(value)}`,
            });
        }

        if (schema.if !== undefined && schema.then !== undefined && passes(schema.if, value, root)) {
            walk(schema.then, value, path, root, problems);
        }
    }

    /**
     * Check `value` against `schema`. `root` is the document $refs resolve in,
     * the schema itself unless a part of a larger one is being checked.
     * -> [{ path, keyword, message }]
     */
    function checkAgainstSchema(schema, value, { root = schema, path = '$' } = {}) {
        const problems = [];
        walk(schema, value, path, root, problems);
        return problems;
    }

    return {
        checkAgainstSchema,
    };
}));
