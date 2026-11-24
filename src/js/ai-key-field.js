// The "Claude API key" field of Run settings: gives a key to the running lab
// for a scan step's AI answers (server-side ai-answer/runtime-key.js). The key
// goes once to the lab's own server, which keeps it in memory; the page keeps
// nothing: the field is emptied once the key is sent, it is not part of the
// configuration, and its typing does not reach the dialog's listeners (undo,
// the settings chips). What the page shows is whether a key is set.

const URL = '/api/ai/key';

/** What the status line says for the server's answer { set, source }. */
export function keyStatusText(status) {
    if (!status || !status.set) return 'No key set: a scan step with AI answers on leaves its questions unanswered.';
    if (status.source === 'app') return 'A key is set for as long as the lab runs. It is forgotten when the lab stops.';
    return 'The lab uses the key in its environment (ANTHROPIC_API_KEY). A key given here is used instead, while the lab runs.';
}

/**
 * Wires the field. `fetchImpl` is for tests. -> { refresh }: asks the server
 * again whether a key is set.
 */
export function setupAiKeyField(doc = document, fetchImpl = (...a) => globalThis.fetch(...a)) {
    const input = doc.getElementById('run-ai-key');
    const setButton = doc.getElementById('run-ai-key-set');
    const forgetButton = doc.getElementById('run-ai-key-forget');
    const statusEl = doc.getElementById('run-ai-key-status');
    if (!input || !setButton || !forgetButton || !statusEl) return { refresh: async () => {} };

    // Not part of the configuration: its typing stays here.
    for (const type of ['input', 'change']) input.addEventListener(type, (e) => e.stopPropagation());

    const show = (status, message = '') => {
        statusEl.textContent = message || keyStatusText(status);
        forgetButton.hidden = !(status && status.source === 'app');
    };

    const call = async (method, body) => {
        try {
            const res = await fetchImpl(URL, {
                method,
                headers: body ? { 'content-type': 'application/json' } : {},
                body: body ? JSON.stringify(body) : undefined,
                cache: 'no-store',
                credentials: 'same-origin',
            });
            const data = await res.json().catch(() => ({}));
            return { ok: res.ok, data };
        } catch {
            return { ok: false, data: { error: 'The lab could not be reached.' } };
        }
    };

    async function refresh() {
        const { ok, data } = await call('GET');
        show(ok ? data : null, ok ? '' : data.error);
    }

    async function useKey() {
        const key = input.value.trim();
        if (!key) { statusEl.textContent = 'Type or paste the key first.'; input.focus(); return; }
        setButton.disabled = true;
        const { ok, data } = await call('PUT', { key });
        setButton.disabled = false;
        // Not kept in the page, whatever the answer.
        input.value = '';
        show(ok ? data : (data.set !== undefined ? data : null), ok ? '' : data.error);
        if (!ok) input.focus();
    }

    async function forget() {
        const { ok, data } = await call('DELETE');
        show(ok ? data : null, ok ? 'The key is forgotten. ' + keyStatusText(data) : data.error);
        input.focus();
    }

    setButton.addEventListener('click', useKey);
    forgetButton.addEventListener('click', forget);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); useKey(); }
    });

    refresh();
    return { refresh };
}
