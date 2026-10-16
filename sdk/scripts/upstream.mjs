import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'sdk/vitest.upstream.config.ts'], { cwd: root, stdio: 'inherit', windowsHide: true });
process.exit(result.status ?? 1);
