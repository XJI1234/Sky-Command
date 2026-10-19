// Local multi-repository workspace: keep one tested implementation of the recorder.
try {
  const location = process.env.XJI_TEST_RECORDS_RUNNER
  await import(location ? (await import('node:url')).pathToFileURL(location).href : new URL('../../XJICloud/scripts/test-records/run.mjs', import.meta.url).href)
} catch (error) {
  console.error('[test-records] Cannot load sibling XJICloud recorder:', error.code ?? 'RECORDER_UNAVAILABLE')
  process.exitCode = 1
}
