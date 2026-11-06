'use strict';

/**
 * npm start and npm run dev: build the report's assets, then run the server
 * - in this process for start, under nodemon for dev.
 *
 * Only what is not tracked is built here (the report's assets). The step
 * reference, docs/configuration_contract.json and the schemas are tracked
 * files: starting the app rewrote them (and their generatedAt) wherever its
 * packs differed from the committer's. They are built by `npm run
 * build:action-docs` when their source changes, and the tests say when one
 * is out of date.
 *
 * One process npm can stop. The scripts were a chain (npm, a shell, npm
 * again, a shell, node) and the shells pass no signal on, so a process
 * manager's SIGTERM ended npm and left the server running, holding its port.
 * Now the server runs in this process, nodemon is handed the signals it gets,
 * and the one shell left between it and npm is watched: npm passes its
 * SIGTERM to that shell, which ends without passing it on, so this process
 * outliving its parent is taken as the stop it was meant to get.
 *
 *   node src/scripts/launch.js start|dev
 */

const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const BUILDS = [
    'src/js/build-report-assets.cjs.js',
];
const FORWARDED = ['SIGINT', 'SIGTERM', 'SIGHUP'];

function build() {
    for (const script of BUILDS) {
        const run = spawnSync(process.execPath, [path.join(ROOT, script)], { cwd: ROOT, stdio: 'inherit' });
        if (run.status !== 0) process.exit(run.status ?? 1);
    }
}

function start() {
    require(path.join(ROOT, 'server.js'));
}

function dev() {
    const nodemon = require.resolve('nodemon/bin/nodemon.js');
    const child = spawn(process.execPath, [nodemon, 'server.js'], { cwd: ROOT, stdio: 'inherit' });
    for (const signal of FORWARDED) {
        process.on(signal, () => child.kill(signal));
    }
    child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

/** Stops this process, as SIGTERM would, once the process that started it is gone. */
function stopWithParent() {
    const parent = process.ppid;
    const watch = setInterval(() => {
        if (process.ppid === parent) return;
        clearInterval(watch);
        process.kill(process.pid, 'SIGTERM');
    }, 500);
    watch.unref();
}

const MODES = { start, dev };
const mode = process.argv[2];
if (!MODES[mode]) {
    console.error('Usage: node src/scripts/launch.js start|dev');
    process.exit(2);
}
build();
stopWithParent();
MODES[mode]();
