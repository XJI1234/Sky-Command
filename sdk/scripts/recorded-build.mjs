import { spawn } from 'node:child_process'

for (const args of [['scripts/build.mjs'], ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], ['scripts/cjs-types.mjs']]) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true })
  const result = await new Promise(resolve => {
    child.once('error', () => resolve(1))
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
  if (result !== 0) { process.exitCode = result; break }
}
