<script setup lang="ts">
import { ref } from 'vue';
import { jsonFields, type SkyCommandClient } from '@xjicloud/sky-command-sdk';
import { useSkyCommand } from '@xjicloud/sky-command-sdk/vue';

const props = defineProps<{ client: SkyCommandClient }>();
const { devices, snapshot, sendCommand } = useSkyCommand(props.client);
const feedback = ref('');
async function refresh(deviceId: string) {
  try {
    const result = await sendCommand(deviceId, { name: 'telemetry.read', fields: jsonFields({}) });
    feedback.value = `${result.status}: ${result.detail}`;
  } catch (error) { feedback.value = error instanceof Error ? error.message : String(error); }
}
// The application/container connects this shared client and disposes it on shutdown.
</script>

<template>
  <section>
    <p>{{ snapshot.status }}</p>
    <p v-if="devices.length === 0">暂无在线设备</p>
    <ul>
      <li v-for="device in devices" :key="device.deviceId">
        {{ device.deviceId }} <button @click="refresh(device.deviceId)">刷新遥测</button>
      </li>
    </ul>
    <p role="status">{{ feedback }}</p>
  </section>
</template>
