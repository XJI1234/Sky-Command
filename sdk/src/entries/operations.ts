import { RelayOperationsAdapter } from '../../../src/production/relay-operations-adapter/index.js';
import type { SkyCommandClient } from '../client.js';
import type { RelayLinkSnapshot } from '../../../src/modules/relay-link/index.js';
import { emptyRelaySnapshot } from '../shared.js';
export * from '../../../src/production/relay-operations-adapter/index.js';

/** Bridges the remote client to existing telemetry projection and business gateways. */
export function createSkyCommandOperations(client: SkyCommandClient) {
  return RelayOperationsAdapter.create({
    relay: {
      devices: client.devices, latestTelemetry: client.latestTelemetry,
      sendCommand: client.sendCommand, sendMission: client.sendMission, measurePhoneLink: client.measurePhoneLink,
      subscribe: (listener: (snapshot: RelayLinkSnapshot) => void) => {
        listener(client.getSnapshot().relay ?? emptyRelaySnapshot);
        return client.subscribe(snapshot => listener(snapshot.relay ?? emptyRelaySnapshot));
      }
    }
  });
}
