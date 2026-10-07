import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { createElement, StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useSkyCommand as useVue } from '../src/vue.js';
import { useSkyCommand as useReact } from '../src/react.js';
import type { SkyCommandClient, SkyCommandSnapshot } from '../src/client.js';
import { deepFreeze, emptyRelaySnapshot } from '../src/shared.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
function store() {
  let state: SkyCommandSnapshot = deepFreeze({ status: 'idle', relay: null, error: null });
  const listeners = new Set<(value: SkyCommandSnapshot) => void>();
  const client = {
    getSnapshot: () => state,
    subscribe: (callback: (value: SkyCommandSnapshot) => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
    connect: vi.fn(), disconnect: vi.fn(), dispose: vi.fn()
  } as unknown as SkyCommandClient;
  return { client, count: () => listeners.size, update: () => {
    state = deepFreeze({ status: 'connected', error: null, relay: { ...emptyRelaySnapshot, devices: [{ deviceId: 'android', sessionId: 'session' }] } });
    for (const callback of listeners) callback(state);
  } };
}
let renderer: ReactTestRenderer | null = null;
afterEach(async () => { if (renderer) await act(() => { renderer!.unmount(); }); renderer = null; });
describe('framework subscriptions', () => {
  it('Vue updates two subscribers, and scope disposal preserves the shared client', () => {
    const source = store(), one = effectScope(), two = effectScope();
    const a = one.run(() => useVue(source.client))!, b = two.run(() => useVue(source.client))!;
    expect(source.count()).toBe(2);
    source.update(); expect(a.devices.value[0]?.deviceId).toBe('android'); expect(b.connected.value).toBe(true);
    one.stop(); expect(source.count()).toBe(1); two.stop(); expect(source.count()).toBe(0);
    expect(source.client.disconnect).not.toHaveBeenCalled(); expect(source.client.dispose).not.toHaveBeenCalled();
    expect(() => useVue(source.client)).toThrow('effect scope');
  });
  it('React subscribes safely under StrictMode, updates and switches clients', async () => {
    const first = store(), second = store();
    function View({ client }: { client: SkyCommandClient }) {
      const sdk = useReact(client); return createElement('span', null, sdk.devices[0]?.deviceId ?? 'empty');
    }
    await act(() => { renderer = create(createElement(StrictMode, null, createElement(View, { client: first.client }))); });
    expect(first.count()).toBe(1);
    await act(() => first.update()); expect(renderer!.toJSON()).toMatchObject({ children: ['android'] });
    await act(() => renderer!.update(createElement(StrictMode, null, createElement(View, { client: second.client }))));
    expect(first.count()).toBe(0); expect(second.count()).toBe(1);
    expect(renderer!.toJSON()).toMatchObject({ children: ['empty'] });
    await act(() => renderer!.unmount()); renderer = null;
    expect(second.count()).toBe(0); expect(first.client.connect).not.toHaveBeenCalled(); expect(second.client.disconnect).not.toHaveBeenCalled();
  });
});
