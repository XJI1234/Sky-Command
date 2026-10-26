// This small example is also bundled from the installed .tgz during browser verification.
import { createApp, h, ref } from 'vue';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createSkyCommandClient, jsonFields } from '@xjicloud/sky-command-sdk';
import { useSkyCommand as useVue } from '@xjicloud/sky-command-sdk/vue';
import { useSkyCommand as useReact } from '@xjicloud/sky-command-sdk/react';

const url = document.body.dataset.gateway!;
function VueDemo() {
  const client = createSkyCommandClient({ url, reconnect: false });
  const sdk = useVue(client), feedback = ref('');
  const connect = async () => { try { await sdk.connect(); } catch (error) { feedback.value = String(error); } };
  const refresh = async () => {
    try { feedback.value = (await sdk.sendCommand(sdk.devices.value[0]!.deviceId, { name: 'telemetry.read', fields: jsonFields({}) })).status; }
    catch (error) { feedback.value = String(error); }
  };
  return () => h('section', [h('h2', 'Vue'), h('button', { onClick: connect }, 'Vue connect'),
    h('p', { 'data-testid': 'vue-status' }, sdk.snapshot.value.status),
    h('p', { 'data-testid': 'vue-devices' }, sdk.devices.value.map(item => item.deviceId).join(',') || 'empty'),
    h('button', { onClick: refresh, disabled: sdk.devices.value.length === 0 }, 'Vue refresh'),
    h('p', { 'data-testid': 'vue-result' }, feedback.value)]);
}
createApp({ setup: VueDemo }).mount('#vue');
const reactClient = createSkyCommandClient({ url, reconnect: false });
function ReactDemo() {
  const sdk = useReact(reactClient), [feedback, setFeedback] = useState('');
  const connect = async () => { try { await sdk.connect(); } catch (error) { setFeedback(String(error)); } };
  const refresh = async () => {
    try { setFeedback((await sdk.sendCommand(sdk.devices[0]!.deviceId, { name: 'telemetry.read', fields: jsonFields({}) })).status); }
    catch (error) { setFeedback(String(error)); }
  };
  return createElement('section', null, createElement('h2', null, 'React'),
    createElement('button', { onClick: connect }, 'React connect'),
    createElement('p', { 'data-testid': 'react-status' }, sdk.snapshot.status),
    createElement('p', { 'data-testid': 'react-devices' }, sdk.devices.map(item => item.deviceId).join(',') || 'empty'),
    createElement('button', { onClick: refresh, disabled: sdk.devices.length === 0 }, 'React refresh'),
    createElement('p', { 'data-testid': 'react-result' }, feedback));
}
createRoot(document.getElementById('react')!).render(createElement(ReactDemo));
