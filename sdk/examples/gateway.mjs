import { createSkyCommandGateway, createSkyCommandRelay } from '@xjicloud/sky-command-sdk/node';

// The Android program connects to ws://<this machine's LAN IPv4>:8765/relay.
const relay = createSkyCommandRelay({ address: { host: '0.0.0.0', port: 8765 } });
const gateway = createSkyCommandGateway({ relay, port: 8766, allowedOrigins: ['http://localhost:5176', 'http://localhost:5173'] });
const result = await relay.start();
if (!result.ok) throw new Error(result.error.message);
try {
  console.log('Control gateway:', (await gateway.start()).url);
} catch (error) { await relay.stop(); throw error; }
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await gateway.stop(); await relay.stop();
}
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
