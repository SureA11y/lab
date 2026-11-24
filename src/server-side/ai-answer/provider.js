'use strict';

// The model behind the AI pass. A provider is `{ name, model, ask(prompt,
// { signal }) -> text }`. The built-in one calls the Anthropic Messages API
// with the key in ANTHROPIC_API_KEY; a test or another backend passes its own.
// With no key there is no provider and the pass leaves every item as it was.

const DEFAULT_MODEL = process.env.A11Y_AI_MODEL || 'claude-sonnet-5-5';

function anthropicProvider(env = process.env) {
    const key = env.ANTHROPIC_API_KEY;
    if (!key) return null;
    const base = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
    const model = env.A11Y_AI_MODEL || DEFAULT_MODEL;
    return {
        name: 'anthropic',
        model,
        async ask(prompt, { signal } = {}) {
            const res = await fetch(`${base}/v1/messages`, {
                method: 'POST',
                signal,
                headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
                body: JSON.stringify({ model, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
            });
            if (!res.ok) throw new Error(`model call failed (${res.status})`);
            const body = await res.json();
            return (body.content || []).map((p) => p.text || '').join('');
        },
    };
}

function resolveProvider(option, env = process.env) {
    if (option && typeof option.ask === 'function') return option;
    return anthropicProvider(env);
}

module.exports = { anthropicProvider, resolveProvider, DEFAULT_MODEL };
