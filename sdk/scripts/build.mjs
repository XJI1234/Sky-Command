import { build } from 'esbuild';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browser = ['index', 'vue', 'react', 'protocol', 'relay', 'device', 'flight', 'mission', 'stream', 'routes', 'photos', 'media', 'operations'];
const nodeEntries = new Set(['node', 'desktop']);
const entryPoints = Object.fromEntries([...browser, 'node', 'desktop', 'shared'].map(name => [name, resolve(root, `src/${['index', 'vue', 'react', 'node', 'shared'].includes(name) ? name : `entries/${name}`}.ts`)]));
await rm(resolve(root, 'dist'), { recursive: true, force: true });
await mkdir(resolve(root, 'dist'), { recursive: true });
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
// Each entry is self-contained; loading core never loads either UI framework or Node.
for (const format of ['esm', 'cjs']) {
  for (const [name, source] of Object.entries(entryPoints)) {
    await build({ entryPoints: [source], outfile: resolve(root, `dist/${name}.${format === 'esm' ? 'js' : 'cjs'}`), bundle: true,
      format, platform: nodeEntries.has(name) ? 'node' : 'browser', target: 'es2022', sourcemap: true,
      external: [...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)],
      plugins: [{ name: 'external-media-server', setup(plugin) {
        plugin.onResolve({ filter: /^node-media-server(?:\/|$)/ }, args => ({ path: args.path, external: true }));
      } }, { name: 'one-shared-runtime', setup(plugin) {
        if (name === 'shared') return;
        plugin.onResolve({ filter: /shared\.js$/ }, args => {
          if (resolve(dirname(args.importer), args.path) !== resolve(root, 'src/shared.js')) return;
          return { path: `./shared.${format === 'esm' ? 'js' : 'cjs'}`, external: true };
        });
      } }],
      metafile: true,
    }).then(async result => {
      const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports.map(item => item.path));
      if (!nodeEntries.has(name) && imports.some(path => path.startsWith('node:') || path === 'ws' || path === 'electron' || path.startsWith('node-media-server'))) throw new Error(`Node leaked into ${name}`);
    });
  }
}
