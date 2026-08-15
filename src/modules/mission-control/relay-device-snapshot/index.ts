function validDeviceId(value: string): boolean {
  const normalized = String(value);
  return normalized.trim().length > 0
    && Array.from(normalized).length <= 128
    && !/[\p{Cc}]/u.test(normalized);
}

function read(value: unknown): ReadonlySet<string> | null {
  try {
    const devices = (value as { readonly devices?: unknown }).devices;
    if (!Array.isArray(devices)) return null;
    const deviceIds = new Set<string>();
    for (const device of devices) {
      const deviceId = (device as { readonly deviceId?: unknown }).deviceId;
      if (typeof deviceId !== "string" || !validDeviceId(deviceId)) return null;
      deviceIds.add(deviceId);
    }
    return deviceIds;
  } catch {
    return null;
  }
}

const reader = Object.create(null) as { read: typeof read };
reader.read = read;

export const RelayDeviceSnapshotReader: Readonly<{ readonly read: typeof read }> = Object.freeze(reader);
