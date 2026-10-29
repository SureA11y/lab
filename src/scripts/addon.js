'use strict';

/**
 * Add-ons: folders in addons/ that bring more to the lab, each with its own
 * dependencies, installed only by whoever wants it. The lab loads an
 * add-on's engines once its dependencies are installed.
 *
 *   npm run addon:list
 *   npm run addon:install -- more-engines
 *   npm run addon:remove -- more-engines
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ADDONS_DIR = path.join(__dirname, '..', '..', 'addons');

function addons() {
    let names = [];
    try {
        names = fs.readdirSync(ADDONS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    } catch {
        return [];
    }
    return names.flatMap((name) => {
        const dir = path.join(ADDONS_DIR, name);
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
            return [{ name, dir, pkg, installed: fs.existsSync(path.join(dir, 'node_modules')) }];
        } catch {
            return [];
        }
    });
}

function find(name) {
    const addon = addons().find((a) => a.name === name);
    if (!addon) {
        console.error(`No add-on "${name}". The add-ons: ${addons().map((a) => a.name).join(', ') || 'none'}.`);
        process.exit(2);
    }
    return addon;
}

function list() {
    for (const a of addons()) {
        const engines = a.pkg.surea11yLab && Array.isArray(a.pkg.surea11yLab.engines) ? a.pkg.surea11yLab.engines : [];
        console.log(`${a.name}  ${a.installed ? 'installed' : 'not installed'}${engines.length ? `  engines: ${engines.join(', ')}` : ''}`);
        if (a.pkg.description) console.log(`  ${a.pkg.description}`);
    }
}

function install(name) {
    const addon = find(name);
    const lock = fs.existsSync(path.join(addon.dir, 'package-lock.json'));
    console.log(`Installing ${name}…`);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const run = spawnSync(npm, [lock ? 'ci' : 'install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: addon.dir, stdio: 'inherit' });
    if (run.status !== 0) process.exit(run.status || 1);
    console.log(`${name} is installed. Restart the lab's server to use it.`);
}

function remove(name) {
    const addon = find(name);
    fs.rmSync(path.join(addon.dir, 'node_modules'), { recursive: true, force: true });
    console.log(`${name} is removed. Restart the lab's server for it to take effect.`);
}

const [command, name] = process.argv.slice(2);
if (command === 'list') list();
else if (command === 'install' && name) install(name);
else if (command === 'remove' && name) remove(name);
else {
    console.error('Usage: node src/scripts/addon.js list | install <name> | remove <name>');
    process.exit(2);
}
