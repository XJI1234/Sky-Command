import { cp, writeFile } from 'node:fs/promises';
await cp(new URL('../dist/types/', import.meta.url), new URL('../dist/types-cjs/', import.meta.url), { recursive: true });
await writeFile(new URL('../dist/types-cjs/package.json', import.meta.url), '{"type":"commonjs"}\n');
