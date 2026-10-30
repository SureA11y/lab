// The marks a tab carries while a run goes on: the spinner, the count
// badge, and the words added to the tab's name so a screen reader hears
// them too.

export function ensureRunTabIndicator() {
    return ensureTabIndicator('mode-run');
}

/** The spinner (and badge) slot inside a mode tab, made on first use. */
export function ensureTabIndicator(tabId) {
    const tabRun = document.getElementById(tabId);
    if (!tabRun) return null;

    let host = tabRun.querySelector('.tab-indicator');
    if (host) return host;

    host = document.createElement('span');
    host.className = 'tab-indicator';
    host.setAttribute('aria-hidden', 'true');

    const spinner = document.createElement('span');
    spinner.className = 'tab-spinner';
    spinner.hidden = true;

    const badge = document.createElement('span');
    badge.className = 'tab-badge';
    badge.hidden = true;
    badge.style.display = 'none';
    badge.textContent = 'Done';

    host.appendChild(spinner);
    host.appendChild(badge);

    tabRun.appendChild(host);
    return host;
}

export function setRunTabSpinner(isOn) {
    const host = ensureRunTabIndicator();
    if (!host) return;

    const tabRun = document.getElementById('mode-run');
    const el = host.querySelector('.tab-spinner');

    if (el) el.hidden = !isOn;

    // a11y name
    if (isOn) {
        setTabA11ySuffix(tabRun, 'running');
    } else {
        // only clear if badge is not showing
        const badge = host.querySelector('.tab-badge');
        const badgeOn = badge ? !badge.hidden : false;
        if (!badgeOn) setTabA11ySuffix(tabRun, '');
    }
}

/** The queue tab works in the background while a batch runs: same spinner and "running" name. */
export function setQueueTabSpinner(isOn) {
    const host = ensureTabIndicator('mode-queue');
    if (!host) return;
    const el = host.querySelector('.tab-spinner');
    if (el) el.hidden = !isOn;
    setTabA11ySuffix(document.getElementById('mode-queue'), isOn ? 'running' : '');
}

export function setRunTabBadge(isOn) {
    const host = ensureRunTabIndicator();
    if (!host) return;

    const tabRun = document.getElementById('mode-run');
    const badge = host.querySelector('.tab-badge');

    if (badge) {
        badge.hidden = !isOn;
        badge.style.display = !isOn ? 'none' : '';
    }

    // a11y name
    if (isOn) {
        setTabA11ySuffix(tabRun, 'updated results available');
    } else {
        // only clear if spinner is not showing
        const spinner = host.querySelector('.tab-spinner');
        const spinnerOn = spinner ? !spinner.hidden : false;
        if (!spinnerOn) setTabA11ySuffix(tabRun, '');
    }
}

export function getBaseTabLabel(tabEl) {
    if (!tabEl) return '';
    // store once
    if (!tabEl.dataset.baseLabel) {
        const base =
            tabEl.getAttribute('aria-label') ||
            tabEl.textContent ||
            '';
        tabEl.dataset.baseLabel = base.trim().replace(/\s+/g, ' ');
    }
    return tabEl.dataset.baseLabel || '';
}

export function setTabA11ySuffix(tabEl, suffix) {
    if (!tabEl) return;
    const base = getBaseTabLabel(tabEl);

    const s = (suffix || '').trim();
    if (!s) {
        tabEl.removeAttribute('aria-label'); // go back to native name
        return;
    }

    tabEl.setAttribute('aria-label', `${base}, ${s}`);
}
