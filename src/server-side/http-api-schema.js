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
const runId = { name: 'runId', in: 'query', required: true, schema: { type: 'string' } };
const since = { name: 'since', in: 'query', required: false, schema: { type: 'integer', minimum: 0 }, description: 'The log index to start from: the last answer\'s nextIndex.' };
const pathParam = (name) => ({ name, in: 'path', required: true, schema: { type: 'string' } });
const engineId = { name: 'engineId', in: 'query', required: false, schema: { type: 'string' } };

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
                        ...ok('Started', { type: 'object', required: ['ok', 'runId'], properties: { ok: { const: true }, runId: { type: 'string' } } }),
                        400: { description: 'A url it cannot open, or no actions', content: json(error) },
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
                        ...ok('Finished: done, cancelled or error. A run that could not start has an error and no payload.', {
                            type: 'object',
                            required: ['status'],
                            properties: {
                                status: { enum: ['done', 'cancelled', 'error'] },
                                payload: { $ref: 'report.v3.schema.json' },
                                error: error,
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
            '/queue': { get: { summary: 'The queue and its recent batches, with links to their results', responses: ok('The queue') } },
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
            '/queue/settings': { post: { summary: 'How many runs at once', requestBody: { content: json({ type: 'object', properties: { concurrency: { type: 'integer', minimum: 1 } } }) }, responses: ok('The concurrency now') } },
            '/queue/items/{itemId}/progress': { get: { summary: 'A queued run\'s log', parameters: [pathParam('itemId'), since], responses: ok('The log', progress) } },
            '/queue/items/{itemId}/cancel': { post: { summary: 'Cancel a queued run', parameters: [pathParam('itemId')], responses: ok('Its status now') } },
            '/queue/cancel': { post: { summary: 'Cancel the batch', responses: ok('What was cancelled') } },
            '/queue/sessions/{sessionId}/masked-fields': { get: { summary: 'The secrets a batch needs typed', parameters: [pathParam('sessionId')], responses: ok('The fields') } },
            '/queue/sessions/{sessionId}/resume': { post: { summary: 'Supply them, and resume', parameters: [pathParam('sessionId')], requestBody: { content: json({ type: 'object', properties: { values: { type: 'object', additionalProperties: { type: 'string' } } } }) }, responses: ok('Resumed') } },
            '/queue/sessions/{sessionId}/delete': { post: { summary: 'Delete a finished batch', parameters: [pathParam('sessionId')], responses: ok('Deleted') } },
            '/queue/sessions/{sessionId}/download.zip': { get: { summary: 'The batch as a report package', parameters: [pathParam('sessionId')], responses: { 200: { description: 'A zip', content: { 'application/zip': {} } } } } },
            '/queue/sessions/{sessionId}/items/{itemId}/download.zip': { get: { summary: 'One run as a report package', parameters: [pathParam('sessionId'), pathParam('itemId')], responses: { 200: { description: 'A zip', content: { 'application/zip': {} } } } } },
            '/workflows/actions': { get: { summary: 'The step definitions, with the engines installed', responses: ok('The definitions') } },
            '/api/engines': { get: { summary: 'The engines installed', responses: ok('The engines') } },
            '/api/engine/capabilities': { get: { summary: 'What an engine can check', parameters: [engineId], responses: ok('Its capabilities') } },
            '/api/engine/rules': { get: { summary: 'An engine\'s rules catalog', parameters: [engineId], responses: ok('The catalog') } },
        },
    };
}

module.exports = { httpApiSchema };
