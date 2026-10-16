import { useState } from 'react';
import { jsonFields, type SkyCommandClient } from '@xjicloud/sky-command-sdk';
import { useSkyCommand } from '@xjicloud/sky-command-sdk/react';

export function ReactDevices({ client }: { client: SkyCommandClient }) {
  const { devices, snapshot, sendCommand } = useSkyCommand(client);
  const [feedback, setFeedback] = useState('');
  async function refresh(deviceId: string) {
    try {
      const result = await sendCommand(deviceId, { name: 'telemetry.read', fields: jsonFields({}) });
      setFeedback(`${result.status}: ${result.detail}`);
    } catch (error) { setFeedback(error instanceof Error ? error.message : String(error)); }
  }
  return <section>
    <p>{snapshot.status}</p>
    {devices.length === 0 && <p>暂无在线设备</p>}
    <ul>{devices.map(device => <li key={device.deviceId}>
      {device.deviceId} <button onClick={() => void refresh(device.deviceId)}>刷新遥测</button>
    </li>)}</ul>
    <p role="status">{feedback}</p>
  </section>;
}
