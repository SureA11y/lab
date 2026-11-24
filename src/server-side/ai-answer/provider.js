'use strict';

// The model behind the AI pass. A provider is `{ name, model }` with
// `ask(prompt, { signal }) -> text`, `answer(question, { signal }) -> answer`,
// or both; the pass uses `answer` when there is one.
//
// Which one, set on the server (never by a workflow or a report, which may come
// from anyone who can open the app):
// - A11Y_AI_ENDPOINT: a service you run, which receives each question as data
//   and answers it (see `endpointProvider` and docs/design/ai-cant-tell-design.md,
//   "Plugging in another model or an agent"). Behind it can be any model, or an
//   agent with its own knowledge.
// - else ANTHROPIC_API_KEY: the Anthropic Messages API.
// - else none, and the pass leaves every item as it was.
// A test or an embedding program passes its own provider object instead.
//
// `destination` says where a provider sends (for the log of what was sent),
// and `bodyFor(input)` gives the body it sends for an input: the log records
// exactly that.

const DEFAULT_MODEL = process.env.A11Y_AI_MODEL || 'claude-sonnet-5-5';

/** The version of the question an endpoint receives. */
const QUESTION_VERSION = 1;

function anthropicProvider(env = process.env) {
    const key = env.ANTHROPIC_API_KEY;
    if (!key) return null;
    const base = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
    const model = env.A11Y_AI_MODEL || DEFAULT_MODEL;
    const bodyFor = (prompt) => ({ model, max_tokens: 400, messages: [{ role: 'user', content: prompt }] });
    return {
        name: 'anthropic',
        model,
        destination: `${base}/v1/messages`,
        bodyFor,
        async ask(prompt, { signal } = {}) {
            const res = await fetch(`${base}/v1/messages`, {
                method: 'POST',
                signal,
                headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
                body: JSON.stringify(bodyFor(prompt)),
            });
            if (!res.ok) throw new Error(`model call failed (${res.status})`);
            const body = await res.json();
            return (body.content || []).map((p) => p.text || '').join('');
        },
    };
}

// "1", "true", "yes" and "on" are true.
const yes = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());

/**
 * A service you run, at A11Y_AI_ENDPOINT (http or https). Each question is
 * POSTed to it as JSON (`question` below, with `version`), with
 * A11Y_AI_ENDPOINT_KEY, when set, as `Authorization: Bearer <key>`. It answers
 * `{ verdict: "pass"|"fail"|"unsure", confidence: 0..1, rationale, answeredBy?:
 * { name, version } }`. The element's picture is sent only with
 * A11Y_AI_ENDPOINT_PICTURE on. A11Y_AI_ENDPOINT_NAME names it in the report
 * when its answers do not.
 */
function endpointProvider(env = process.env) {
    const raw = String(env.A11Y_AI_ENDPOINT || '').trim();
    if (!raw) return null;
    let url;
    try { url = new URL(raw); } catch { throw new Error('A11Y_AI_ENDPOINT is not a web address'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('A11Y_AI_ENDPOINT must be an http or https address');
    const key = env.A11Y_AI_ENDPOINT_KEY || '';
    const picture = yes(env.A11Y_AI_ENDPOINT_PICTURE);
    const bodyFor = (question) => {
        const body = { version: QUESTION_VERSION, ...question };
        if (!picture && body.evidence) body.evidence = (({ screenshot, ...rest }) => rest)(body.evidence);
        return body;
    };
    return {
        name: 'endpoint',
        model: String(env.A11Y_AI_ENDPOINT_NAME || '').trim() || url.host,
        destination: url.origin + url.pathname,
        sendsPicture: picture,
        bodyFor,
        async answer(question, { signal } = {}) {
            const res = await fetch(url, {
                method: 'POST',
                signal,
                headers: { 'content-type': 'application/json', accept: 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
                body: JSON.stringify(bodyFor(question)),
            });
            if (!res.ok) throw new Error(`endpoint call failed (${res.status})`);
            return res.json();
        },
    };
}

function resolveProvider(option, env = process.env) {
    if (option && (typeof option.ask === 'function' || typeof option.answer === 'function')) return option;
    return endpointProvider(env) || anthropicProvider(env);
}

module.exports = { anthropicProvider, endpointProvider, resolveProvider, DEFAULT_MODEL, QUESTION_VERSION };
