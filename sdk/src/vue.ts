import { computed, getCurrentScope, onScopeDispose, shallowReadonly, shallowRef } from 'vue';
import type { SkyCommandClient } from './client.js';

/** Subscribe inside setup/effectScope. The caller owns the shared connection. */
export function useSkyCommand(client: SkyCommandClient) {
  if (!getCurrentScope()) throw new Error('useSkyCommand requires an active Vue effect scope');
  const snapshot = shallowRef(client.getSnapshot());
  const unsubscribe = client.subscribe(value => { snapshot.value = value; });
  snapshot.value = client.getSnapshot();
  onScopeDispose(unsubscribe);
  return {
    client,
    snapshot: shallowReadonly(snapshot),
    devices: computed(() => snapshot.value.relay?.devices ?? []),
    telemetry: computed(() => snapshot.value.relay?.telemetry ?? []),
    connected: computed(() => snapshot.value.status === 'connected'),
    connect: client.connect, disconnect: client.disconnect,
    sendCommand: client.sendCommand, sendMission: client.sendMission, measurePhoneLink: client.measurePhoneLink
  };
}
