import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { WebSocket } from 'ws';

const exec = promisify(execFile), root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = resolve(root, '.verification/consumer');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script with npm run verify:package');
const run = async (args, cwd = fixture, quiet = false) => {
  const { stdout, stderr } = await exec(process.execPath, args, { cwd, windowsHide: true, maxBuffer: 4000000, timeout: 120000 });
  if (!quiet && stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.log(stderr.trim());
  return stdout;
};
await mkdir(resolve(root, 'artifacts'), { recursive: true });
await mkdir(fixture, { recursive: true });
const packed = JSON.parse(await run([npmCli, 'pack', '--json', '--pack-destination', 'artifacts'], root, true));
console.log(`Packed ${packed[0].filename}: ${packed[0].size} bytes`);
const tarball = resolve(root, 'artifacts', packed[0].filename);
await writeFile(resolve(fixture, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
await run([npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', tarball]);
await writeFile(resolve(fixture, 'core.mjs'), `import assert from 'node:assert/strict';
import { createSkyCommandClient, jsonFields } from '@xjicloud/sky-command-sdk';
const client = createSkyCommandClient({url:'ws://localhost/sdk'});
assert.equal(client.getSnapshot().status,'idle'); client.dispose();
assert.deepEqual(Object.keys(jsonFields({})),[]);
console.log('Core ESM import and SSR initialization passed');\n`);
await run([resolve(fixture, 'core.mjs')]);
const reactMajor = process.env.SKY_SDK_REACT_MAJOR ?? '19';
if (!['18', '19'].includes(reactMajor)) throw new Error('SKY_SDK_REACT_MAJOR must be 18 or 19');
await run([npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', 'vue@^3.5.32', `react@^${reactMajor}.0.0`, `react-dom@^${reactMajor}.0.0`, `@types/react@^${reactMajor}.0.0`, `@types/react-dom@^${reactMajor}.0.0`, '@types/node@^24.0.0']);
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const names = Object.keys(pkg.exports).filter(name => name !== './package.json').map(name => name === '.' ? pkg.name : `${pkg.name}/${name.slice(2)}`);
await writeFile(resolve(fixture, 'all.mjs'), names.map(name => `await import('${name}');`).join('\n') + `
import assert from 'node:assert/strict';
import {SkyCommandError} from '${pkg.name}';
import {createSkyCommandGateway, createSkyCommandRelay} from '${pkg.name}/node';
assert.throws(() => createSkyCommandGateway({relay:createSkyCommandRelay({address:{host:'127.0.0.1',port:9000}}),host:'0.0.0.0'}), SkyCommandError);
console.log("All ESM entries and shared error identity passed");`);
await writeFile(resolve(fixture, 'all.cjs'), names.map(name => `require('${name}');`).join('\n') + `
const assert = require('node:assert/strict'); const {SkyCommandError} = require('${pkg.name}');
const {createSkyCommandGateway,createSkyCommandRelay} = require('${pkg.name}/node');
assert.throws(() => createSkyCommandGateway({relay:createSkyCommandRelay({address:{host:'127.0.0.1',port:9000}}),host:'0.0.0.0'}),SkyCommandError);
console.log("All CommonJS entries and shared error identity passed");`);
await run([resolve(fixture, 'all.mjs')]); await run([resolve(fixture, 'all.cjs')]);
await writeFile(resolve(fixture, 'consumer.mts'), names.map((name, index) => `import * as api${index} from '${name}'; void api${index};`).join('\n'));
await writeFile(resolve(fixture, 'consumer.cts'), names.map((name, index) => `import api${index} = require('${name}'); void api${index};`).join('\n'));
await copyFile(resolve(root, 'examples/ReactDevices.tsx'), resolve(fixture, 'ReactDevices.tsx'));
await copyFile(resolve(root, 'examples/business.mjs'), resolve(fixture, 'business.mjs'));
await writeFile(resolve(fixture, 'business-check.mjs'), `import { createSkyCommandClient } from '${pkg.name}'; import { createBusiness } from './business.mjs';
const client = createSkyCommandClient({url:'ws://localhost/sdk'}); const business = createBusiness(client); business.dispose(); client.dispose(); console.log('Business composition passed');`);
await run([resolve(fixture, 'business-check.mjs')]);
await run([resolve(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--jsx', 'react-jsx', '--allowJs', '--checkJs', 'consumer.mts', 'consumer.cts', 'ReactDevices.tsx', 'business.mjs']);
await copyFile(resolve(root, 'examples/browser-demo.ts'), resolve(fixture, 'demo.ts'));
await build({ entryPoints: [resolve(fixture, 'demo.ts')], outfile: resolve(fixture, 'demo.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', define: { 'process.env.NODE_ENV': '"production"' } });
const { createSkyCommandRelay, createSkyCommandGateway } = await import(pathToFileURL(resolve(fixture, 'node_modules/@xjicloud/sky-command-sdk/dist/node.js')));
const { RelayFrameCodec } = await import(pathToFileURL(resolve(fixture, 'node_modules/@xjicloud/sky-command-sdk/dist/protocol.js')));
const portServer = createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
const relayPort = portServer.address().port; await new Promise(done => portServer.close(done));
const relay = createSkyCommandRelay({ address: { host: '127.0.0.1', port: relayPort } });
let gateway, web, browser, phone;
let gatewayUrl = '';
const errors = [], results = [];
try {
  assert.equal((await relay.start()).ok, true);
  web = createServer(async (req, res) => {
    if (req.url === '/demo.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(resolve(fixture, 'demo.js'))); }
    else { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><meta charset="utf-8"><title>SDK validation</title><body data-gateway="${gatewayUrl}"><div id="vue"></div><div id="react"></div><script type="module" src="/demo.js"></script></body>`); }
  });
  web.listen(0, '127.0.0.1'); await once(web, 'listening');
  const origin = `http://127.0.0.1:${web.address().port}`;
  gateway = createSkyCommandGateway({ relay, port: 0, allowedOrigins: [origin] }); gatewayUrl = (await gateway.start()).url;
  phone = new WebSocket(`ws://127.0.0.1:${relayPort}/relay`);
  phone.on('message', bytes => {
    const decoded = RelayFrameCodec.decode(new Uint8Array(bytes));
    if (decoded.kind === 'decoded' && decoded.frame.type === 'command') {
      const encoded = RelayFrameCodec.encode({ type: 'command-result', id: decoded.frame.id, ok: true, detail: 'browser test' });
      if (encoded.ok) phone.send(encoded.value);
    }
  });
  await once(phone, 'open');
  phone.send(RelayFrameCodec.encode({ type: 'hello', deviceId: 'android-browser', protocolVersion: '1' }).value);
  await once(phone, 'message');
  let executablePath = process.env.SKY_SDK_BROWSER_EXECUTABLE;
  if (!executablePath && process.platform === 'win32') {
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    try { await access(edge); executablePath = edge; } catch { /* use installed Playwright Chromium */ }
  }
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(origin);
  for (const framework of ['Vue', 'React']) {
    const key = framework.toLowerCase();
    assert.equal(await page.getByTestId(`${key}-devices`).textContent(), 'empty');
    await page.getByRole('button', { name: `${framework} connect`, exact: true }).click();
    await page.getByTestId(`${key}-devices`).filter({ hasText: 'android-browser' }).waitFor();
    await page.getByRole('button', { name: `${framework} refresh`, exact: true }).click();
    await page.getByTestId(`${key}-result`).filter({ hasText: 'succeeded' }).waitFor();
    results.push(`${framework}: connect, device list, command result`);
  }
  phone.terminate();
  for (const key of ['vue', 'react']) await page.getByTestId(`${key}-devices`).filter({ hasText: 'empty' }).waitFor();
  results.push('Both frameworks clear devices after Android disconnect');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: resolve(root, '.verification/browser.png'), fullPage: true });
  await writeFile(resolve(root, `.verification/report-react${reactMajor}.json`), JSON.stringify({ tarball, reactMajor, browser: await browser.version(), results, errors }, null, 2));
  console.log(results.join('\n')); console.log(`Validated archive: ${tarball}`);
} finally {
  phone?.terminate(); await browser?.close(); await gateway?.stop(); await relay.stop();
  if (web) await new Promise(done => { web.close(done); web.closeAllConnections(); });
}
