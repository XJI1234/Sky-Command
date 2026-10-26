import { useSyncExternalStore } from 'react';
import type { SkyCommandClient } from './client.js';

/** No effect creates sockets; safe for shared clients, SSR and StrictMode. */
export function useSkyCommand(client: SkyCommandClient) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  return {
    client, snapshot,
    devices: snapshot.relay?.devices ?? [],
    telemetry: snapshot.relay?.telemetry ?? [],
    connected: snapshot.status === 'connected',
    connect: client.connect, disconnect: client.disconnect,
    sendCommand: client.sendCommand, sendMission: client.sendMission, measurePhoneLink: client.measurePhoneLink
  };
}
