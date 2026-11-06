'use strict';

/**
 * http-api-schema.js
 *
 * The server's public calls (docs/http-api.md) as OpenAPI 3.1, with the run
 * spec and report schemas in schemas/ as their request and response types.
 * `npm run build:action-docs` writes it to schemas/http-api.openapi.json, and a
 * test holds every path in it to a route the server has.
 *
 * Node: module.exports.
 */

const json = (schema) => ({ 'application/json': { schema } });
const error = { type: 'object', properties: { error: { type: 'string' }, details: { type: 'string' } } };
// A run refused before it starts: every reason, one each, in problems.
const refusal = { type: 'object', properties: { error: { type: 'string' }, details: { type: 'string' }, problems: { type: 'array', items: { type: 'string' } } } };
// Why a run failed: the step that failed, where it was one.
const runError = { type: 'object', properties: { error: { type: 'string' }, details: { type: 'string' }, actionPath: { type: 'string' }, actionType: { type: 'string' } } };
const runId = { name: 'runId', in: 'query', required: true, schema: { type: 'string' } };
const since = { name: 'since', in: 'query', required: false, schema: { type: 'integer', minimum: 0 }, description: 'The log index to start from: the last answer\'s nextIndex.' };
const pathParam = (name) => ({ name, in: 'path', required: true, schema: { type: 'string' } });

const progress = {
    type: 'object',
    required: ['status', 'nextIndex', 'logs'],
    properties: {
        status: { type: 'string' },
        nextIndex: { type: 'integer' },
        logs: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    time: { type: 'string' },
                    type: { type: 'string' },
                    message: { type: 'string' },
                    depth: { type: 'integer' },
                },
            },
        },
    },
};

// A run spec's fields, as /workflow-start takes them: type and specVersion
// may be left out.
const runRequest = {
    allOf: [{ $ref: 'run-spec.v1.schema.json' }],
    description: 'A run spec (schemas/run-spec.v1.schema.json). type and specVersion may be left out here; dryRun: true asks for a dry run.',
};

const ok = (description, schema = { type: 'object' }) => ({ 200: { description, content: json(schema) } });

function httpApiSchema() {
    return {
        openapi: '3.1.0',
        info: {
            title: 'surea11y-lab HTTP API',
            version: '1',
            description: 'Start a run, follow it and take its report; or queue a batch and download its results (docs/http-api.md). '
                + 'There is no login: publish the server only where whoever reaches it may use it. '
                + 'Generated from src/server-side/http-api-schema.js by `npm run build:action-docs`; do not edit schemas/http-api.openapi.json by hand.',
        },
        servers: [{ url: 'http://127.0.0.1:3000' }],
        paths: {
            '/health': { get: { summary: 'Whether the server is up', responses: ok('Up', { type: 'object', properties: { status: { const: 'ok' } } }) } },
            '/workflow-start': {
                post: {
                    summary: 'Start a run',
                    requestBody: { required: true, content: json(runRequest) },
                    responses: {
                        ...ok('Started', { type: 'object', required: ['ok', 'runId'], properties: {
                            ok: { const: true },
                            runId: { type: 'string' },
                            warnings: { type: 'array', items: { type: 'string' }, description: 'What the run\'s check found worth saying but not refusing, such as an unknown field ignored.' },
                        } }),
                        400: { description: 'A run that cannot work as asked: the run\'s fields, its steps, its scans\' profiles and selectors, a navigate step\'s address, a secret not set in the server\'s environment', content: json(refusal) },
                        429: {
                            description: 'Every run slot (A11Y_MAX_RUNS) and every place to wait (A11Y_MAX_WAITING) taken: try again after Retry-After seconds',
                            headers: { 'Retry-After': { schema: { type: 'integer' } } },
                            content: json(error),
                        },
                    },
                },
            },
            '/workflow-progress': {
                get: {
                    summary: 'A run\'s log, from an index on',
                    parameters: [runId, since],
                    responses: { ...ok('The log', progress), 404: { description: 'Unknown runId', content: json(error) } },
                },
            },
            '/workflow-result': {
                get: {
                    summary: 'A run\'s result',
                    parameters: [runId],
                    responses: {
                        ...ok('Finished: done, cancelled or error. A failed run\'s error says why, beside the payload of what it got before it failed, or alone when it failed before its first scan. A run cancelled while it waited its turn has no payload.', {
                            type: 'object',
                            required: ['status'],
                            properties: {
                                status: { enum: ['done', 'cancelled', 'error'] },
                                payload: { $ref: 'report.v4.schema.json' },
                                error: runError,
                                dryRun: { type: 'object', description: 'A dry run\'s summary, as run-workflow.js --dry-run prints it.' },
                            },
                        }),
                        202: { description: 'Still running', content: json({ type: 'object', properties: { status: { type: 'string' } } }) },
                        404: { description: 'Unknown runId', content: json(error) },
                    },
                },
            },
            '/workflow-cancel': {
                post: {
                    summary: 'Cancel a run',
                    requestBody: { required: true, content: json({ type: 'object', required: ['runId'], properties: { runId: { type: 'string' } } }) },
                    responses: { ...ok('Cancelling'), 404: { description: 'Unknown runId', content: json(error) } },
                },
            },
            '/queue': { get: { summary: 'The queue and its recent batches, each in summary: counts, stats, scans, the slowest run, the runs going now and the last to finish, and itemsUrl, where its runs are', responses: ok('The queue') } },
            '/queue/sessions/{sessionId}/items': {
                get: {
                    summary: 'A batch\'s runs, a page at a time, in the order they were queued',
                    parameters: [
                        pathParam('sessionId'),
                        { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0 } },
                        { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 500 }, description: '100 unless given; at most 500.' },
                        { name: 'status', in: 'query', required: false, schema: { type: 'string' }, description: 'Only runs with these statuses, comma-separated (waiting, running, done, failed, error, cancelled, interrupted).' },
                    ],
                    responses: {
                        ...ok('The page', { type: 'object', properties: { sessionId: { type: 'string' }, total: { type: 'integer' }, offset: { type: 'integer' }, limit: { type: 'integer' }, items: { type: 'array', items: { type: 'object' } } } }),
                        404: { description: 'No such batch', content: json(error) },
                    },
                },
            },
            '/queue/sessions/{sessionId}/items/{itemId}/rerun': { post: { summary: 'Run a finished batch\'s row again: its result waits beside the row\'s active one until /keep says which to keep; a re-run that ends with none leaves nothing to choose', parameters: [pathParam('sessionId'), pathParam('itemId')], requestBody: { content: json({ type: 'object', properties: { values: { type: 'object', additionalProperties: { type: 'string' }, description: 'The hidden values its workflow needs, by the keys masked-fields?item= gives.' } } }) }, responses: { ...ok('Running again'), 409: { description: 'A batch is running, or an earlier re-run\'s result waits for a choice', content: json(error) } } } },
            '/queue/sessions/{sessionId}/items/{itemId}/keep': { post: { summary: 'After Run again, which result the row keeps: new (the re-run\'s becomes its result), active (the re-run\'s is let go) or both (the re-run\'s is kept as a version, the active one staying active; five results a row at most)', parameters: [pathParam('sessionId'), pathParam('itemId')], requestBody: { required: true, content: json({ type: 'object', required: ['keep'], properties: { keep: { type: 'string', enum: ['new', 'active', 'both'] } } }) }, responses: { ...ok('Kept', { type: 'object', properties: { sessionId: { type: 'string' }, itemId: { type: 'string' }, kept: { type: 'string' }, removedPictures: { type: 'integer' }, removedRunFolders: { type: 'integer' } } }), 400: { description: 'Not new, active or both', content: json(error) }, 404: { description: 'No such run in this batch', content: json(error) }, 409: { description: 'A batch is running, nothing waits for a choice, or the row keeps five results already', content: json(error) } } } },
            '/queue/sessions/{sessionId}/items/{itemId}/versions/activate': { post: { summary: 'Make one of a row\'s kept versions its result, the one the batch\'s totals, zip and Send to Compare use', parameters: [pathParam('sessionId'), pathParam('itemId')], requestBody: { required: true, content: json({ type: 'object', required: ['file'], properties: { file: { type: 'string', description: 'The version\'s result file, as versions[].file gives it.' } } }) }, responses: { ...ok('Made active'), 404: { description: 'No such run, or no such version of it', content: json(error) }, 409: { description: 'A batch is running, or a re-run\'s result waits for a choice', content: json(error) } } } },
            '/queue/sessions/{sessionId}/items/{itemId}/versions/delete': { post: { summary: 'Delete one of a row\'s kept versions, with the pictures and run folders only it used; not the active one', parameters: [pathParam('sessionId'), pathParam('itemId')], requestBody: { required: true, content: json({ type: 'object', required: ['file'], properties: { file: { type: 'string' } } }) }, responses: { ...ok('Deleted'), 404: { description: 'No such run, or no such version of it', content: json(error) }, 409: { description: 'A batch is running, or a re-run\'s result waits for a choice', content: json(error) } } } },
            '/queue/sessions/{sessionId}/items/{itemId}/delete': { post: { summary: 'Delete one run of a finished batch: its row, its result, and the pictures and run folders only it used; not the batch\'s only run', parameters: [pathParam('sessionId'), pathParam('itemId')], responses: { ...ok('Deleted', { type: 'object', properties: { sessionId: { type: 'string' }, deleted: { type: 'string' }, remaining: { type: 'integer' }, removedPictures: { type: 'integer' }, removedRunFolders: { type: 'integer' } } }), 404: { description: 'No such run in this batch', content: json(error) }, 409: { description: 'A batch is running, or this is the batch\'s only run', content: json(error) } } } },
            '/queue/items': {
                post: {
                    summary: 'Queue a batch',
                    requestBody: {
                        required: true,
                        content: json({
                            type: 'object',
                            required: ['items'],
                            properties: {
                                name: { type: 'string' },
                                items: {
                                    type: 'array',
                                    minItems: 1,
                                    items: { type: 'object', required: ['run'], properties: { run: runRequest, row: { type: 'integer' }, config: { $ref: 'app-config.v1.schema.json' } } },
                                },
                            },
                        }),
                    },
                    responses: { ...ok('Queued'), 400: { description: 'A run that cannot be queued', content: json(error) }, 409: { description: 'Another batch is running', content: json(error) } },
                },
            },
            '/queue/settings': { post: { summary: 'How many runs at once: a number, or "auto" for as many as a batch has, up to the maximum (the default)', requestBody: { content: json({ type: 'object', properties: { concurrency: { anyOf: [{ type: 'integer', minimum: 1 }, { const: 'auto' }] } } }) }, responses: ok('The concurrency now') } },
            '/queue/items/{itemId}/progress': { get: { summary: 'A queued run\'s log', parameters: [pathParam('itemId'), since], responses: ok('The log', progress) } },
            '/queue/items/{itemId}/cancel': { post: { summary: 'Cancel a queued run', parameters: [pathParam('itemId')], responses: ok('Its status now') } },
            '/queue/cancel': { post: { summary: 'Cancel the batch', responses: ok('What was cancelled') } },
            '/queue/sessions/{sessionId}/masked-fields': { get: { summary: 'The secrets a batch needs typed: to resume it, or with ?item= to run that row again', parameters: [pathParam('sessionId'), { name: 'item', in: 'query', required: false, schema: { type: 'string' } }], responses: ok('The fields') } },
            '/queue/sessions/{sessionId}/resume': { post: { summary: 'Supply them, and resume', parameters: [pathParam('sessionId')], requestBody: { content: json({ type: 'object', properties: { values: { type: 'object', additionalProperties: { type: 'string' } } } }) }, responses: ok('Resumed') } },
            '/queue/sessions/{sessionId}/delete': { post: { summary: 'Delete a finished batch', parameters: [pathParam('sessionId')], responses: ok('Deleted') } },
            '/queue/sessions/{sessionId}/download.zip': { get: { summary: 'The batch as a report package', parameters: [pathParam('sessionId')], responses: { 200: { description: 'A zip', content: { 'application/zip': {} } } } } },
            '/queue/sessions/{sessionId}/items/{itemId}/download.zip': { get: { summary: 'One run as a report package: its result, or with ?file= another of its results (a kept version, or a re-run\'s waiting for a choice)', parameters: [pathParam('sessionId'), pathParam('itemId'), { name: 'file', in: 'query', required: false, schema: { type: 'string' } }], responses: { 200: { description: 'A zip', content: { 'application/zip': {} } } } } },
            '/workflows/actions': { get: { summary: 'The step definitions', responses: ok('The definitions') } },
            '/api/engine/capabilities': { get: { summary: 'What surea11y can check: its options and the profiles it supports', responses: ok('Its capabilities') } },
            '/api/engine/rules': { get: { summary: 'surea11y\'s rules catalog', responses: ok('The catalog') } },
        },
    };
}

module.exports = { httpApiSchema };
