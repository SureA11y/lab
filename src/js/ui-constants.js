// Values the app's parts share: the kinds of status line, how often a run's
// progress is asked for, and the keys the app keeps in local storage.

export const STATUS = {OK: 'ok', BUSY: 'busy', ERROR: 'error', WARNING: 'warning', DEBUG: 'debug', INFO: 'info'};
export const PROGRESS_POLL_INTERVAL_MS = 800;
export const TAB_MODE_STORAGE_KEY = 'a11ylab-active-mode';
export const GROUPING_STATE_STORAGE_KEY = 'a11ylab-grouping-state-v1';
