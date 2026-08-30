type RecordValue = Record<string, unknown>;

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const record = (value: unknown): RecordValue | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
const read = (value: unknown, key: string): unknown => { try { return record(value)?.[key]; } catch { return undefined; } };
const safeText = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value) ? value : null;
const boundedInteger = (value: unknown, minimum: number, maximum: number): number | null => typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
const boundedNumber = (value: unknown, minimum: number, maximum: number): number | null => typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
const rounded = (value: number, decimals: number): string => {
  const factor = 10 ** decimals;
  const normalized = Math.round(value * factor) / factor;
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(decimals);
};
const duration = (seconds: number): string => `低电量返航预估 ${Math.floor(seconds / 60)}分${seconds % 60}秒`;

function format(connection: unknown): string {
  const parts: string[] = [];
  const aircraftModel = safeText(read(connection, "aircraftModel"));
  const remoteControllerModel = safeText(read(connection, "remoteControllerModel"));
  if (aircraftModel !== null) parts.push(`机型 ${aircraftModel}`);
  if (remoteControllerModel !== null) parts.push(`遥控器 ${remoteControllerModel}`);

  const battery = boundedInteger(read(connection, "batteryPercent"), 0, 100);
  parts.push(battery === null ? "电量尚未取得" : `电量 ${battery}%`);
  const remaining = boundedInteger(read(connection, "remainingFlightTimeSeconds"), 0, 86_400);
  if (remaining !== null) parts.push(duration(remaining));

  const flightState = read(connection, "flightState");
  parts.push(flightState === "flying" ? "飞机在空中" : flightState === "grounded" ? "飞机在地面" : "飞行状态尚未确认");
  const motorsOn = read(connection, "motorsOn");
  if (motorsOn === true) parts.push("电机已启动");
  else if (motorsOn === false) parts.push("电机未启动");
  const flightMode = safeText(read(connection, "flightMode"));
  if (flightMode !== null) parts.push(`飞行模式 ${flightMode}`);

  const pose = read(connection, "pose");
  const altitude = boundedNumber(read(pose, "altitudeMeters"), -20_000, 20_000);
  if (altitude !== null) parts.push(`高度 ${rounded(altitude, 1)} m`);
  const latitude = boundedNumber(read(pose, "latitude"), -90, 90);
  const longitude = boundedNumber(read(pose, "longitude"), -180, 180);
  if (latitude !== null && longitude !== null) parts.push(`位置 ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);

  const live = read(connection, "live");
  if (read(live, "streaming") === true) {
    parts.push("图传中");
    const resolution = safeText(read(live, "resolution"));
    if (resolution !== null) parts.push(resolution);
    const fps = boundedNumber(read(live, "fps"), 0, 240);
    if (fps !== null) parts.push(`${rounded(fps, 0)} fps`);
    const bitrate = boundedNumber(read(live, "videoBitrateKbps"), 0, 100_000);
    if (bitrate !== null) parts.push(`${rounded(bitrate, 0)} kbps`);
    const rtt = boundedInteger(read(live, "rttMillis"), 0, 60_000);
    if (rtt !== null) parts.push(`RTT ${rtt} ms`);
  }
  return parts.join(" · ");
}

export const DeviceFactSummary = freeze({ format });
