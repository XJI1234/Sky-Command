import flvjs from "flv.js";
import { OperatorConsole } from "../index.js";
import { clearRoutePreview, drawnPreviewId, ensureRouteMap, locateDrawnRoute, resizeRouteMap, routeMapNotice, showRoutePreview, type RouteMapPreview } from "./route-map.js";

type WorkspaceName = "devices" | "routes" | "flight";
type MissionStartIntent = Readonly<{ deviceId: string; missionId: string; routeId: string; routeName: string }>;
type RendererBridge = {
  readonly invoke: (name: string, input?: unknown) => Promise<unknown>;
  readonly relayHint?: string;
  readonly incidentLog?: string;
  readonly selectRouteFile?: () => Promise<{ ok?: boolean; fileName?: string; bytes?: Uint8Array }>;
};

const state: { workspace: WorkspaceName; missionDeviceId: string | null; streamDeviceId: string | null } = {
  workspace: "devices",
  missionDeviceId: null,
  streamDeviceId: null,
};

const bridge = (): RendererBridge => {
  const api = (window as unknown as { skyCommand?: RendererBridge }).skyCommand;
  if (api === undefined || typeof api.invoke !== "function") throw new Error("渲染进程只能通过 skyCommand.invoke 访问网关");
  return api;
};

const unwrap = (result: unknown): unknown => {
  if (result === null || typeof result !== "object" || !("ok" in result) || (result as { ok: unknown }).ok !== true) return result;
  return (result as { value?: unknown }).value;
};

const read = (value: unknown, key: string): unknown => value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
const text = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value : null;

const el = (id: string): HTMLElement => {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`缺少 ${id}`);
  return node;
};

const show = (message: string): void => { el("status").textContent = message; };

const flightActionLabel = (action: unknown): string => {
  if (action === "takeoff") return "起飞";
  if (action === "land") return "降落";
  if (action === "return-home" || action === "returnHome" || action === "rth") return "返航";
  return typeof action === "string" && action.length > 0 ? action : "该动作";
};

const operatorNotice = (value: unknown): string => {
  const inner = unwrap(value);
  const codeOf = (source: unknown): string | null => typeof read(source, "code") === "string" ? read(source, "code") as string : null;
  const reasonOf = (source: unknown): string | null => typeof read(source, "reason") === "string" ? read(source, "reason") as string : null;
  const reason = reasonOf(inner) ?? reasonOf(value);
  const code = codeOf(inner) ?? codeOf(value);
  if (code === "HARDWARE_NOT_READY") {
    const blockers = read(inner, "blockers") ?? read(value, "blockers");
    if (Array.isArray(blockers)) {
      const messages = blockers.map((item) => read(item, "message")).filter((message): message is string => typeof message === "string" && message.length > 0);
      if (messages.length > 0) return `实机预检未通过：${messages.join("；")}`;
    }
    return "实机预检未通过";
  }
  if (reason === "ANOTHER_VIDEO_TRANSPORT_ACTIVE") return "另一路图传正在使用，请先停止";
  if (reason === "VIDEO_TRANSPORT_FAILED") return "图传未能完成";
  if (reason === "VIDEO_TRANSPORT_UNAVAILABLE") return "图传当前不可用";
  if (code === "RELAY_REJECTED") return "手机拒绝了该命令，请在手机上看原因后重试";
  if (code === "CAPABILITY_BLOCKED") {
    if (reason === "RELAY_OFFLINE") return "手机已离线，无法发送图传命令";
    if (reason === "SDK_NOT_READY") return "手机端 DJI 尚未就绪，无法启动图传";
    if (reason === "LIVE_VIDEO_UNAVAILABLE") return "图传链路当前未就绪，请确认 DJI 产品、AirLink 和主相机均已连接后刷新状态";
    return "图传启动条件刚发生变化，请刷新设备状态后重试";
  }
  if (code === "OPERATION_IN_PROGRESS") return "上一条命令还在处理，请稍候";
  if (code === "VIDEO_NOT_READY") return "画面还没出来，请稍候或重新启动图传";
  if (code === "DISCONNECTED") return "手机已离线，请先在设备页连上手机";
  if (code === "DEPENDENCY_FAILURE") return "暂时无法完成，请稍后重试";
  if (read(inner, "ok") === true) return "已发送到手机";
  if (read(value, "ok") === true && read(inner, "ok") !== false) return "已发送到手机";
  return code === null ? "已发送到手机" : "暂时无法完成，请稍后重试";
};

let flvPlayer: ReturnType<typeof flvjs.createPlayer> | null = null;
let attachedUrl: string | null = null;
let flvFatalStreak = 0;
let flvRecoverTimer: number | null = null;
let lastPlaybackHealthAt = 0;
let attachedAtMs = 0;
let lastPaintAtMs = 0;
let lastSeenCurrentTime = 0;
let selectedPlaybackDeviceId: string | null = null;
let pendingMissionStart: MissionStartIntent | null = null;

const NO_FRAME_MS = 8_000;
const STALL_MS = 12_000;

const clearFlvRecoverTimer = (): void => {
  if (flvRecoverTimer === null) return;
  window.clearTimeout(flvRecoverTimer);
  flvRecoverTimer = null;
};

const isPainting = (video: HTMLVideoElement): boolean =>
  video.videoWidth > 0 && !video.paused && Number.isFinite(video.currentTime) && video.currentTime > 0;

const detachVideo = (): void => {
  clearFlvRecoverTimer();
  const video = el("video") as HTMLVideoElement;
  if (flvPlayer !== null) {
    try { flvPlayer.pause(); } catch { /* ignore */ }
    try { flvPlayer.unload(); } catch { /* ignore */ }
    try { flvPlayer.detachMediaElement(); } catch { /* ignore */ }
    try { flvPlayer.destroy(); } catch { /* ignore */ }
    flvPlayer = null;
  }
  attachedUrl = null;
  attachedAtMs = 0;
  lastPaintAtMs = 0;
  lastSeenCurrentTime = 0;
  selectedPlaybackDeviceId = null;
  video.removeAttribute("src");
  video.srcObject = null;
  video.load();
};

const playVideo = (video: HTMLVideoElement): void => {
  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
  video.setAttribute("playsinline", "");
  void video.play().catch((error: unknown) => {
    const name = error instanceof Error ? error.name : "";
    show(name === "NotAllowedError" ? "自动播放被拦截，请点一下上方画面" : "图传已就绪但未出画，请点上方播放");
  });
};

const softReloadFlv = (video: HTMLVideoElement): boolean => {
  const url = attachedUrl;
  if (url === null) return false;
  // unload/load 容易叠两条 HTTP；整段销毁再挂可保证单连接。
  try {
    detachVideo();
    attachVideo(url);
    playVideo(video);
    return flvPlayer !== null;
  } catch {
    return false;
  }
};

const chaseLiveEdge = (video: HTMLVideoElement): void => {
  if (flvPlayer === null || attachedUrl === null || !isPainting(video)) return;
  try {
    if (video.buffered.length === 0) return;
    const end = video.buffered.end(video.buffered.length - 1);
    if (!Number.isFinite(end)) return;
    const lag = end - video.currentTime;
    // 直播积压超过约 1.2s 就追到前沿，避免「一顿一顿往前赶」。
    if (lag > 1.2) video.currentTime = Math.max(0, end - 0.25);
  } catch { /* ignore */ }
};

const scheduleFlvReattach = (retryUrl: string): void => {
  clearFlvRecoverTimer();
  const delayMs = Math.min(5_000, 800 * (2 ** Math.min(flvFatalStreak - 1, 3)));
  flvRecoverTimer = window.setTimeout(() => {
    flvRecoverTimer = null;
    attachVideo(retryUrl);
  }, delayMs);
};

const recoverStuckFlv = (video: HTMLVideoElement, url: string, reason: string): void => {
  if (flvRecoverTimer !== null) return;
  flvFatalStreak += 1;
  if (flvFatalStreak <= 3 && softReloadFlv(video)) {
    show(`${reason}，正在自动恢复…`);
    return;
  }
  show(`${reason}，正在重新连接…`);
  detachVideo();
  scheduleFlvReattach(url);
};

const notePaintProgress = (video: HTMLVideoElement): void => {
  if (!isPainting(video)) return;
  const current = video.currentTime;
  if (lastPaintAtMs === 0 || Math.abs(current - lastSeenCurrentTime) >= 0.05) {
    lastPaintAtMs = Date.now();
    lastSeenCurrentTime = current;
    flvFatalStreak = 0;
  }
};

const watchPlaybackStall = (video: HTMLVideoElement): void => {
  if (attachedUrl === null || flvPlayer === null || flvRecoverTimer !== null) return;
  const now = Date.now();
  notePaintProgress(video);
  chaseLiveEdge(video);
  if (isPainting(video)) {
    if (lastPaintAtMs > 0 && now - lastPaintAtMs > STALL_MS) {
      recoverStuckFlv(video, attachedUrl, "画面停住");
    }
    return;
  }
  if (attachedAtMs > 0 && now - attachedAtMs > NO_FRAME_MS) {
    recoverStuckFlv(video, attachedUrl, "长时间未出画");
  }
};

const reportPlaybackHealth = (video: HTMLVideoElement): void => {
  const now = Date.now();
  if (now - lastPlaybackHealthAt < 2_000) return;
  lastPlaybackHealthAt = now;
  notePaintProgress(video);
  if (isPainting(video)) {
    show(video.videoWidth > 0 ? `图传正常播放中（${video.videoWidth}×${video.videoHeight}）` : "图传正常播放中");
    return;
  }
  if (attachedUrl !== null && flvPlayer !== null) {
    show("图传已启动，正在等待画面…若长时间无画面请点「停止图传」后重试");
  }
};

const attachVideo = (url: string): void => {
  const video = el("video") as HTMLVideoElement;
  if (attachedUrl === url && flvPlayer !== null) {
    if (isPainting(video)) {
      notePaintProgress(video);
      reportPlaybackHealth(video);
      return;
    }
    if (video.paused) playVideo(video);
    // 已附着但不出画：不得直接 return，交给卡死看门狗做软恢复/重挂。
    watchPlaybackStall(video);
    reportPlaybackHealth(video);
    return;
  }
  clearFlvRecoverTimer();
  detachVideo();
  attachedUrl = url;
  attachedAtMs = Date.now();
  lastPaintAtMs = 0;
  lastSeenCurrentTime = 0;
  const play = (): void => {
    playVideo(video);
    reportPlaybackHealth(video);
  };
  if (!url.includes(".flv") || !flvjs.isSupported()) {
    show("当前电脑无法播放图传画面，请重启 Sky Command 后再试");
    return;
  }
  flvPlayer = flvjs.createPlayer(
    { type: "flv", isLive: true, hasAudio: false, url },
    // 小 stash 缓毛刺/网络抖动；过大则延迟明显。背压策略已在 HTTP-FLV 侧按关键frame 续写。
    { enableStashBuffer: false, stashInitialSize: 128, lazyLoad: false, autoCleanupSourceBuffer: true },
  );
  flvPlayer.on(flvjs.Events.ERROR, () => {
    flvFatalStreak += 1;
    const retryUrl = attachedUrl;
    if (retryUrl === null) return;
    if (flvFatalStreak <= 3 && softReloadFlv(video)) {
      show("图传不稳定，正在自动恢复…");
      return;
    }
    show("图传中断，正在重新连接…");
    detachVideo();
    scheduleFlvReattach(retryUrl);
  });
  flvPlayer.attachMediaElement(video);
  flvPlayer.load();
  play();
};

const accepted = (value: unknown): boolean => value !== null && typeof value === "object" && (value as { ok?: unknown }).ok === true;

const playbackUrl = (value: unknown): string | null => {
  const body = unwrap(value);
  if (body !== null && typeof body === "object" && read(body, "ok") === false) return null;
  const url = read(body, "url");
  if (typeof url === "string" && url.trim().length > 0) return url;
  const nested = unwrap(body);
  const nestedUrl = read(nested, "url");
  return typeof nestedUrl === "string" && nestedUrl.trim().length > 0 ? nestedUrl : null;
};

async function ensurePlayback(view: ReturnType<typeof OperatorConsole.project>): Promise<void> {
  if (!view.playbackReady) {
    if (attachedUrl !== null) detachVideo();
    return;
  }
  if (view.streamDeviceId === null) return;
  const url = playbackUrl(await bridge().invoke("video-playback", { deviceId: view.streamDeviceId }));
  if (url === null) return;
  attachVideo(url);
  if (flvPlayer === null || attachedUrl !== url) return;
  if (selectedPlaybackDeviceId !== view.streamDeviceId) {
    const selected = await bridge().invoke("stream-select", { deviceId: view.streamDeviceId });
    if (!accepted(selected)) return;
    selectedPlaybackDeviceId = view.streamDeviceId;
  }
  watchPlaybackStall(el("video") as HTMLVideoElement);
}

const connectionLabel = (connection: unknown, key: string, ok: string, disconnected: string, unknownLabel: string): string => {
  const value = read(connection, key);
  if (value === "ready" || value === "connected" || value === "online") return ok;
  if (value === "disconnected") return disconnected;
  return unknownLabel;
};

const connected = (connection: unknown, key: string): boolean => {
  const value = read(connection, key);
  return value === "ready" || value === "connected" || value === "online";
};

const msdkFact = (connection: unknown): { readonly label: string; readonly ok: boolean } => {
  switch (read(connection, "msdk")) {
    case "ready": return { label: "MSDK 已就绪", ok: true };
    case "starting": return { label: "MSDK 正在初始化", ok: false };
    case "failed": return { label: "MSDK 初始化失败", ok: false };
    case "stopped": return { label: "MSDK 已停止", ok: false };
    default: return { label: "MSDK 状态未知", ok: false };
  }
};

const pairingFact = (connection: unknown): { readonly label: string; readonly ok: boolean } => {
  switch (read(connection, "pairingState")) {
    case "PAIRED": return { label: "已对频", ok: true };
    case "PAIRING": return { label: "对频中", ok: false };
    case "STOPPING": return { label: "正在结束对频", ok: false };
    case "FAILED": return { label: "对频失败", ok: false };
    case "IDLE": return { label: "未对频", ok: false };
    case "UNKNOWN": return { label: "对频状态未知", ok: false };
    default: return { label: "对频状态未知", ok: false };
  }
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

const statusRow = (name: string, label: string, ok: boolean): string =>
  `<div class="connection-status-row"><span class="connection-status-name">${escapeHtml(name)}</span><span class="connection-status-value${ok ? " ok" : ""}">${escapeHtml(label)}</span></div>`;

const finiteNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const optionalText = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value : null;
const durationLabel = (value: unknown): string | null => {
  const seconds = finiteNumber(value);
  if (seconds === null || !Number.isInteger(seconds) || seconds <= 0) return null;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
};
const lowBatteryRthLabel = (value: unknown): string | null => {
  if (value === "IDLE") return "未触发";
  if (value === "COUNTING_DOWN") return "正在倒计时";
  if (value === "EXECUTED") return "已执行";
  if (value === "CANCELLED") return "已取消";
  return null;
};
const flightFactsUnconfirmed = (connection: unknown): boolean => read(connection, "flightController") === "unknown";
const telemetryTimeKnown = (connection: unknown): boolean => finiteNumber(read(connection, "telemetryReceivedAtMs")) !== null;
const telemetryTimeLabel = (connection: unknown): string => {
  const receivedAtMs = finiteNumber(read(connection, "telemetryReceivedAtMs"));
  if (receivedAtMs === null) return flightFactsUnconfirmed(connection) ? "尚未收到有效状态，飞控状态当前未确认" : "尚未收到有效状态";
  const ageSeconds = Math.max(0, Math.floor((Date.now() - receivedAtMs) / 1_000));
  const clock = new Date(receivedAtMs).toLocaleTimeString("zh-CN", { hour12: false });
  if (flightFactsUnconfirmed(connection)) return `上次更新于 ${clock}（${ageSeconds <= 2 ? "刚刚" : `${ageSeconds} 秒前`}），飞控状态当前未确认`;
  return ageSeconds <= 2 ? `刚刚（${clock}）` : `${ageSeconds} 秒前（${clock}）`;
};

const deviceFactRows = (connection: unknown): string => {
  const pose = read(connection, "pose");
  const live = read(connection, "live");
  const aircraftModel = optionalText(read(connection, "aircraftModel"));
  const remoteControllerModel = optionalText(read(connection, "remoteControllerModel"));
  const battery = finiteNumber(read(connection, "batteryPercent"));
  const rthState = lowBatteryRthLabel(read(connection, "lowBatteryRthState"));
  const remaining = rthState === null ? null : durationLabel(read(connection, "remainingFlightTimeSeconds"));
  const flightMode = optionalText(read(connection, "flightMode"));
  const altitude = finiteNumber(read(pose, "altitudeMeters"));
  const latitude = finiteNumber(read(pose, "latitude"));
  const longitude = finiteNumber(read(pose, "longitude"));
  const resolution = optionalText(read(live, "resolution"));
  const fps = finiteNumber(read(live, "fps"));
  const bitrate = finiteNumber(read(live, "videoBitrateKbps"));
  const rtt = finiteNumber(read(live, "rttMillis"));
  const packetLoss = finiteNumber(read(live, "packetLoss"));
  const packetCacheLength = finiteNumber(read(live, "packetCacheLength"));
  const flightState = read(connection, "flightState") === "grounded" ? "地面" : read(connection, "flightState") === "flying" ? "飞行中" : "尚未确认";
  const motors = read(connection, "motorsOn") === true ? "已启动" : read(connection, "motorsOn") === false ? "已关闭" : "尚未确认";
  const streaming = read(live, "streaming") === true ? "MSDK 报告正在推流" : read(live, "streaming") === false ? "MSDK 报告未推流" : "尚未取得";
  return [
    statusRow("机型 [ProductKey.KeyProductType]", aircraftModel ?? "尚未取得", aircraftModel !== null),
    statusRow("遥控器型号 [RemoteControllerKey.KeyRemoteControllerType]", remoteControllerModel ?? "尚未取得", remoteControllerModel !== null),
    statusRow("飞行状态 [FlightControllerKey.KeyIsFlying]", flightState, false),
    statusRow("电机 [FlightControllerKey.KeyAreMotorsOn]", motors, false),
    statusRow("电量 [BatteryKey.KeyChargeRemainingInPercent, LEFT_OR_MAIN]", battery === null ? "尚未取得" : `${battery}%`, battery !== null),
    statusRow("低电量返航状态 [FlightControllerKey.KeyLowBatteryRTHInfo]", rthState ?? "尚未取得", rthState !== null),
    statusRow("低电量返航预估 [FlightControllerKey.KeyLowBatteryRTHInfo]", remaining ?? "尚未取得", remaining !== null),
    statusRow("飞行模式 [FlightControllerKey.KeyFCFlightMode]", flightMode ?? "尚未取得", flightMode !== null),
    statusRow("高度 [FlightControllerKey.KeyAltitude]", altitude === null ? "尚未取得" : `${altitude.toFixed(1)} 米`, altitude !== null),
    statusRow("位置 [FlightControllerKey.KeyAircraftLocation]", latitude === null || longitude === null ? "尚未取得" : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`, latitude !== null && longitude !== null),
    statusRow("MSDK 图传观测 [手机 MSDK 图传运行观测]", streaming, read(live, "streaming") === true),
    statusRow("图传分辨率 [手机 MSDK 图传运行观测]", resolution ?? "尚未取得", resolution !== null),
    statusRow("图传帧率 [手机 MSDK 图传运行观测]", fps === null ? "尚未取得" : `${fps} fps`, fps !== null),
    statusRow("图传码率 [手机 MSDK 图传运行观测]", bitrate === null ? "尚未取得" : `${bitrate} Kbps`, bitrate !== null),
    statusRow("图传丢包 [LiveStreamStatus.packetLoss]", packetLoss === null ? "尚未取得" : String(packetLoss), packetLoss !== null),
    statusRow("图传缓存长度 [LiveStreamStatus.packetCacheLen]", packetCacheLength === null ? "尚未取得" : String(packetCacheLength), packetCacheLength !== null),
    statusRow("图传往返时间 [手机 MSDK 图传运行观测]", rtt === null ? "尚未取得" : `${rtt} ms`, rtt !== null),
    statusRow("状态更新时间 [桌面接收时间]", telemetryTimeLabel(connection), telemetryTimeKnown(connection) && !flightFactsUnconfirmed(connection)),
  ].join("");
};

const missionRuntimeLabel = (mission: unknown): string => {
  switch (read(mission, "phase")) {
    case "staging": return "准备中";
    case "staged": return "已暂存到手机";
    case "uploading": return "上传中";
    case "uploaded": return "已上传至飞机";
    case "starting": return "启动中，等待飞机确认";
    case "running": return "执行中";
    case "pausing": return "暂停中";
    case "paused": return "已暂停";
    case "resuming": return "恢复中";
    case "stopping": return "停止中";
    case "completed": return "已完成";
    case "failed": return "失败";
    case "disconnected": return "链路中断";
    case "idle": return "未开始";
    default: return "状态未知";
  }
};

const streamRuntimeLabel = (device: unknown): string => {
  const stream = read(device, "stream");
  const live = read(read(device, "connection"), "live");
  switch (read(stream, "phase")) {
    case "starting": return "启动中";
    case "stopping": return "停止中";
    case "failed": return "失败";
    case "disconnected": return "链路中断";
    case "streaming":
      return read(live, "streaming") === true ? "推流中" : read(live, "streaming") === false ? "已接收启动命令，等待推流" : "已接收启动命令，等待状态确认";
    case "idle":
      return read(live, "streaming") === true ? "MSDK 报告推流中（非当前控制会话）" : "已停止";
    default: return "状态未知";
  }
};

const playbackRuntimeLabel = (device: unknown, streamDeviceId: string | null): string => {
  if (read(device, "deviceId") !== streamDeviceId) return "未选为当前播放器";
  const video = read(device, "video");
  switch (read(video, "phase")) {
    case "awaiting-ingest": return "等待流进入";
    case "awaiting-playback": return "等待播放器";
    case "failed": return "播放失败";
    case "ready": {
      if (read(video, "selected") !== true) return "等待播放器";
      const player = document.getElementById("video");
      return player instanceof HTMLVideoElement && isPainting(player) ? "正在播放" : "等待播放器出画";
    }
    case "unavailable": return "未开始";
    default: return "状态未知";
  }
};

const runtimeStatusRows = (device: unknown, streamDeviceId: string | null): string => [
  statusRow("任务 [手机任务运行状态]", missionRuntimeLabel(read(device, "mission")), false),
  statusRow("手机推流 [手机图传运行状态]", streamRuntimeLabel(device), false),
  statusRow("桌面播放 [桌面播放器运行状态]", playbackRuntimeLabel(device, streamDeviceId), false),
].join("");

async function projectView(): Promise<ReturnType<typeof OperatorConsole.project>> {
  const snapshotResult = unwrap(await bridge().invoke("state-snapshot"));
  const snapshot = unwrap(snapshotResult) ?? {};
  const hintResult = unwrap(await bridge().invoke("network-hint"));
  const listed = read(hintResult, "hints");
  const liveHints = Array.isArray(listed) ? listed.filter((item): item is string => typeof item === "string" && item.startsWith("ws://")) : [];
  return OperatorConsole.project({
    snapshot,
    selection: { missionDeviceId: state.missionDeviceId, streamDeviceId: state.streamDeviceId },
    workspace: state.workspace,
    relayHint: liveHints.length > 0 ? liveHints.join(" 或 ") : bridge().relayHint,
  });
}

const blocked = (action: string, reason: string): void => {
  show(reason);
  void bridge().invoke("diagnostics-record", { action, reason });
};

async function run(action: string, invokeName: string, input: unknown): Promise<void> {
  const view = await projectView();
  const decision = OperatorConsole.evaluate(action, view);
  if (!decision.ok) { blocked(action, decision.reason ?? "无法执行"); return; }
  show(operatorNotice(await bridge().invoke(invokeName, input)));
  await render();
}

const createMissionStartIntent = (view: ReturnType<typeof OperatorConsole.project>): MissionStartIntent | null => {
  const deviceId = view.missionDeviceId;
  const missionId = text(read(view.mission, "missionId"));
  const route = view.missionRoute;
  return deviceId !== null && missionId !== null && route !== null
    ? Object.freeze({ deviceId, missionId, routeId: route.routeId, routeName: route.displayName })
    : null;
};

const requestMissionStartConfirmation = async (view: ReturnType<typeof OperatorConsole.project>): Promise<void> => {
  const decision = OperatorConsole.evaluate("mission-start", view);
  if (!decision.ok) { blocked("mission-start", decision.reason ?? "无法执行航线"); return; }
  const intent = createMissionStartIntent(view);
  if (intent === null) {
    blocked("mission-start", "已上传任务的身份不完整，请重新准备并上传航线");
    return;
  }
  pendingMissionStart = intent;
  await render();
};

const confirmMissionStart = async (): Promise<void> => {
  const intent = pendingMissionStart;
  pendingMissionStart = null;
  if (intent === null) { await render(); return; }
  const view = await projectView();
  if (
    view.missionDeviceId !== intent.deviceId ||
    text(read(view.mission, "missionId")) !== intent.missionId ||
    view.missionRoute?.routeId !== intent.routeId
  ) {
    blocked("mission-start", "任务、目标飞机或航线已变化，请重新确认");
    await render();
    return;
  }
  await run("mission-start", "mission-start", { deviceId: intent.deviceId });
};

function renderDevices(view: ReturnType<typeof OperatorConsole.project>): void {
  const devices = view.devices as readonly Record<string, unknown>[];
  const count = el("connection-count");
  count.textContent = devices.length > 0 ? `${devices.length} 台手机已连接` : "等待手机连接";
  count.classList.toggle("online", devices.length > 0);
  el("device-list").replaceChildren(...devices.map((device) => {
    const node = document.createElement("div");
    node.className = "device";
    if (device.deviceId === view.missionDeviceId) node.classList.add("inspected");
    const connection = device.connection ?? {};
    const msdk = msdkFact(connection);
    node.innerHTML = `<strong>${escapeHtml(String(device.deviceId))}</strong><div class="muted">${msdk.label} · ${connectionLabel(connection, "remoteController", "遥控器已连接", "遥控器未连接", "遥控器状态未知")} · ${connectionLabel(connection, "flightController", "飞控已连接", "飞控未连接", "飞控状态未知")} · ${connectionLabel(connection, "aircraft", "DJI 硬件产品已连接", "DJI 硬件产品未连接", "DJI 硬件产品状态未知")}</div>`;
    node.addEventListener("click", () => { state.missionDeviceId = String(device.deviceId); void render(); });
    return node;
  }));
  const inspected = devices.find((item) => item.deviceId === view.missionDeviceId);
  const refresh = el("device-refresh") as HTMLButtonElement;
  refresh.disabled = inspected === undefined;
  refresh.title = inspected === undefined ? "请先选择已连接的手机" : "读取当前手机状态";
  const connection = inspected === undefined ? {} : inspected.connection as Record<string, unknown> ?? {};
  const msdk = msdkFact(connection);
  const pairing = pairingFact(connection);
  el("device-detail").innerHTML = inspected === undefined
    ? "从左侧选择已连接的手机。"
    : `<p class="muted">编号 ${escapeHtml(String(inspected.deviceId))}</p>
      <h3 class="device-status-heading">连接状态</h3>
      <div class="connection-status-list" aria-label="连接状态">
        ${statusRow("电脑到手机中继 [桌面 Relay Session]", "中继在线", true)}
        ${statusRow("MSDK 生命周期 [SDKManager]", msdk.label, msdk.ok)}
        ${statusRow("遥控器连接 [RemoteControllerKey.KeyConnection]", connectionLabel(connection, "remoteController", "遥控器已连接", "遥控器未连接", "遥控器状态未知"), connected(connection, "remoteController"))}
        ${statusRow("对频状态 [RemoteControllerKey.KeyPairingStatus]", pairing.label, pairing.ok)}
        ${statusRow("飞控连接 [FlightControllerKey.KeyConnection]", connectionLabel(connection, "flightController", "飞控已连接", "飞控未连接", "飞控状态未知"), connected(connection, "flightController"))}
        ${statusRow("DJI 硬件产品连接 [ProductKey.KeyConnection]", connectionLabel(connection, "aircraft", "DJI 硬件产品已连接", "DJI 硬件产品未连接", "DJI 硬件产品状态未知"), connected(connection, "aircraft"))}
        ${statusRow("AirLink 连接 [AirLinkKey.KeyConnection]", connectionLabel(connection, "airLink", "AirLink 已连接", "AirLink 未连接", "AirLink 状态未知"), connected(connection, "airLink"))}
        ${statusRow("主相机连接 [CameraKey.KeyConnection, LEFT_OR_MAIN]", connectionLabel(connection, "camera", "主相机已连接", "主相机未连接", "主相机状态未知"), connected(connection, "camera"))}
      </div>
      <h3 class="device-status-heading">动态飞行事实</h3>
      <div class="connection-status-list" aria-label="动态飞行事实">${deviceFactRows(connection)}</div>
      <h3 class="device-status-heading">运行状态</h3>
      <div class="connection-status-list" aria-label="运行状态">${runtimeStatusRows(inspected, view.streamDeviceId)}</div>
      <p class="muted">对频仅用于新增飞机或更换遥控器。这里只显示手机回报的结果。</p>`;
  el("device-guide").textContent = `电脑和手机连同一 Wi-Fi。在手机上填写 ${view.relayHint}，点保存并启动。已对频的飞机会在开机后自动连接；只有新增飞机或更换遥控器时，才在手机上开始对频。电脑关掉后，需要在手机上重新连接。`;
}

function renderRoutes(view: ReturnType<typeof OperatorConsole.project>): void {
  const selected = view.selectedRoute;
  const hasRoute = view.routes.length > 0;
  el("route-picker-wrap").hidden = !hasRoute;
  el("route-details").hidden = selected === null || selected === undefined;
  el("route-empty").hidden = hasRoute;
  const select = el("route-select") as HTMLSelectElement;
  select.replaceChildren(...view.routes.map((route) => Object.assign(document.createElement("option"), {
    value: route.routeId,
    textContent: route.displayName,
    selected: selected?.routeId === route.routeId,
  })));
  if (selected !== null && selected !== undefined) select.value = selected.routeId;
  select.onchange = async () => {
    const decision = OperatorConsole.evaluate("select-route", view);
    if (!decision.ok) { show(decision.reason ?? "无法选择航线"); return; }
    await bridge().invoke("route-select", { routeId: select.value });
    await render();
  };
  if (selected === null || selected === undefined) {
    el("route-file-name").textContent = "";
    el("route-meta").textContent = "";
    el("route-summary").textContent = hasRoute ? "请选择要预览的航线" : "尚未导入航迹文件";
    return;
  }
  el("route-file-name").textContent = selected.displayName;
  el("route-meta").textContent = selected.executable
    ? "可提交给飞机"
    : `${selected.blockedReason ?? "KML 只能预览"} · 要飞这条航线需要 Wayline 导出的 KMZ`;
}

function renderFlight(view: ReturnType<typeof OperatorConsole.project>): void {
  const devices = view.devices as readonly Record<string, unknown>[];
  const fill = (id: string, selected: string | null, onChange: (value: string) => void): void => {
    const select = el(id) as HTMLSelectElement;
    select.replaceChildren(...[
      Object.assign(document.createElement("option"), { value: "", textContent: "未选择" }),
      ...devices.map((device) => Object.assign(document.createElement("option"), {
        value: String(device.deviceId),
        textContent: String(device.deviceId),
        selected: device.deviceId === selected,
      })),
    ]);
    select.onchange = () => { onChange(select.value || ""); void render(); };
  };
  fill("mission-select", view.missionDeviceId, (value) => { state.missionDeviceId = value.length > 0 ? value : null; });
  fill("stream-select", view.streamDeviceId, (value) => { state.streamDeviceId = value.length > 0 ? value : null; });
  el("mission-label").textContent = view.missionDeviceId === null ? "未选择任务机" : `${view.missionDeviceId} · ${view.missionLabel}`;
  const activeRoute = view.missionRoute;
  el("flight-route").textContent = activeRoute === null
    ? view.selectedRoute === null
      ? "尚未在航线页选择可执行 KMZ"
      : `待准备航线：${view.selectedRoute.displayName} · ${view.selectedRoute.executable ? "可提交" : view.selectedRoute.blockedReason}`
    : `当前任务航线：${activeRoute.displayName}${view.selectedRoute?.routeId === activeRoute.routeId ? "" : `（航线页当前选择：${view.selectedRoute?.displayName ?? "无"}）`}`;
  const missionButtonActions = Object.freeze({
    stage: "mission-stage",
    upload: "mission-upload",
    start: "mission-start",
    pause: "mission-pause",
    resume: "mission-resume",
    stop: "mission-stop",
  } as const);
  for (const [action, dataAction] of Object.entries(missionButtonActions) as Array<[keyof typeof missionButtonActions, string]>) {
    const button = document.querySelector(`button[data-action="${dataAction}"]`);
    if (!(button instanceof HTMLButtonElement)) continue;
    const availability = view.missionActions[action];
    button.disabled = !availability.enabled;
    button.title = availability.enabled ? button.textContent ?? "" : availability.reason ?? "当前阶段不能执行此操作";
  }
  const streamStopping = view.streamLabel === "正在停止图传";
  el("stream-label").textContent = view.streamLabel;
  el("stream-label").classList.toggle("ok", !streamStopping && (view.playbackReady || view.streamCanStart));
  const streamReady = el("stream-ready");
  if (streamStopping) {
    streamReady.textContent = view.streamCanStart
      ? "正在等待手机确认停止。可点「停止后重启图传」，确认后才会重新启动。"
      : "正在等待手机确认停止。停止完成后才能重新启动图传。";
    streamReady.classList.remove("ok");
  } else if (view.playbackReady || view.streamCanStop) {
    streamReady.textContent = view.playbackReady
      ? "画面已就绪。要结束请点「停止图传」"
      : `${view.streamLabel}。要结束请点「停止图传」`;
    streamReady.classList.add("ok");
  } else if (view.streamCanStart) {
    streamReady.textContent = "图传可请求启动：电脑、中继、手机 MSDK、DJI 产品、AirLink 和主相机均已就绪，真实推流结果以手机 DJI 和首帧为准";
    streamReady.classList.add("ok");
  } else {
    streamReady.textContent = view.streamLabel.startsWith("图传未就绪")
      ? view.streamLabel
      : `现在不能启动图传：${view.streamLabel}`;
    streamReady.classList.remove("ok");
  }
  const startButton = document.querySelector('button[data-action="stream-start"]');
  if (startButton instanceof HTMLButtonElement) {
    startButton.disabled = !view.streamCanStart;
    startButton.textContent = streamStopping && view.streamCanStart ? "停止后重启图传" : "启动图传";
    startButton.title = view.streamCanStart ? streamStopping ? "手机确认停止后自动重新启动图传" : "启动图传" : view.streamLabel;
  }
  const stopButton = document.querySelector('button[data-action="stream-stop"]');
  if (stopButton instanceof HTMLButtonElement) {
    const canStop = !streamStopping && (view.streamCanStop || attachedUrl !== null);
    stopButton.disabled = !canStop;
    stopButton.title = canStop ? "停止图传" : streamStopping ? "正在等待手机确认停止" : "当前没有进行中的图传";
  }
  const guidance = view.guidance as { message?: string } | null;
  el("guidance").textContent = guidance?.message ?? "";
  const confirm = el("confirm");
  if (view.confirmation !== null) {
    confirm.hidden = false;
    el("confirm-text").textContent = `确认让 ${view.confirmation.deviceId} ${flightActionLabel(view.confirmation.action)}？此操作会立刻下发到飞机；停止航线不会自动返航。`;
    confirm.dataset.deviceId = view.confirmation.deviceId;
    confirm.dataset.confirmationId = view.confirmation.confirmationId;
  } else {
    confirm.hidden = true;
  }
  const missionConfirm = el("mission-confirm");
  const intent = pendingMissionStart;
  const currentMissionId = text(read(view.mission, "missionId"));
  if (
    intent === null ||
    view.missionDeviceId !== intent.deviceId ||
    currentMissionId !== intent.missionId ||
    view.missionRoute?.routeId !== intent.routeId
  ) {
    pendingMissionStart = null;
    missionConfirm.hidden = true;
  } else {
    missionConfirm.hidden = false;
    el("mission-confirm-text").textContent = `确认让 ${intent.deviceId} 执行航线「${intent.routeName}」？手机会在调用 DJI 前再次检查设备状态。`;
  }
}

const deepUnwrap = (value: unknown, key: string): unknown => {
  let current: unknown = value;
  for (let step = 0; step < 4; step += 1) {
    if (read(current, key) !== undefined) return current;
    const next = unwrap(current);
    if (next === current) return current;
    current = next;
  }
  return current;
};

const previewGeometry = (value: unknown): { polyline: RouteMapPreview["polyline"]; startMarker: RouteMapPreview["startMarker"]; endMarker: RouteMapPreview["endMarker"] } | null => {
  const current = deepUnwrap(value, "polyline");
  const polyline = read(current, "polyline");
  const startMarker = read(current, "startMarker");
  const endMarker = read(current, "endMarker");
  if (!Array.isArray(polyline) || polyline.length < 2 || startMarker === undefined || endMarker === undefined) return null;
  const points = polyline.flatMap((item) => {
    const longitude = read(item, "longitude");
    const latitude = read(item, "latitude");
    const altitude = read(item, "altitude");
    return typeof longitude === "number" && typeof latitude === "number"
      ? [{ longitude, latitude, altitude: typeof altitude === "number" ? altitude : null }]
      : [];
  });
  const marker = (source: unknown) => {
    const longitude = read(source, "longitude");
    const latitude = read(source, "latitude");
    const altitude = read(source, "altitude");
    return typeof longitude === "number" && typeof latitude === "number"
      ? { longitude, latitude, altitude: typeof altitude === "number" ? altitude : null }
      : null;
  };
  const start = marker(startMarker);
  const end = marker(endMarker);
  return points.length >= 2 && start !== null && end !== null ? { polyline: points, startMarker: start, endMarker: end } : null;
};

async function syncRouteMap(view: ReturnType<typeof OperatorConsole.project>): Promise<void> {
  if (state.workspace !== "routes") return;
  await ensureRouteMap(el("map"));
  resizeRouteMap();
  el("map-notice").textContent = routeMapNotice();
  const routeId = view.selectedRoute?.routeId ?? null;
  if (routeId === null) {
    if (drawnPreviewId() !== null) clearRoutePreview();
    return;
  }
  if (drawnPreviewId() === routeId) {
    el("route-summary").textContent = `${view.selectedRoute?.displayName ?? ""} · ${routeMapNotice()}`;
    return;
  }
  const preview = previewGeometry(await bridge().invoke("route-preview", { routeId }));
  if (preview === null) {
    clearRoutePreview();
    el("map-notice").textContent = "当前航线没有可预览的航迹。";
    return;
  }
  showRoutePreview(routeId, preview);
  el("map-notice").textContent = routeMapNotice();
  el("route-summary").textContent = `${view.selectedRoute?.displayName ?? ""} · ${preview.polyline.length} 个航点`;
}

async function render(): Promise<void> {
  document.querySelectorAll("nav button").forEach((button) => {
    button.classList.toggle("active", (button as HTMLButtonElement).dataset.workspace === state.workspace);
  });
  document.querySelectorAll("main").forEach((node) => {
    node.classList.toggle("active", node.id === `workspace-${state.workspace}`);
  });
  const view = await projectView();
  state.missionDeviceId = view.missionDeviceId;
  state.streamDeviceId = view.streamDeviceId;
  renderDevices(view);
  renderRoutes(view);
  renderFlight(view);
  await syncRouteMap(view);
}

document.querySelectorAll("nav button").forEach((button) => {
  button.addEventListener("click", () => {
    const workspace = (button as HTMLButtonElement).dataset.workspace;
    if (workspace === "devices" || workspace === "routes" || workspace === "flight") state.workspace = workspace;
    void render();
  });
});

el("device-refresh").addEventListener("click", async () => {
  const view = await projectView();
  const deviceId = view.missionDeviceId;
  if (deviceId === null) { show("请先选择已连接的手机"); return; }
  const button = el("device-refresh") as HTMLButtonElement;
  button.disabled = true;
  try {
    const result = unwrap(await bridge().invoke("device-refresh", { deviceId }));
    show(accepted(result) ? "已读取当前手机状态，请查看各项状态" : operatorNotice(result));
  } catch {
    show("状态刷新失败，请检查手机连接后重试");
  } finally {
    await render();
  }
});

el("route-import").addEventListener("click", async () => {
  const button = el("route-import") as HTMLButtonElement;
  const view = await projectView();
  const decision = OperatorConsole.evaluate("import-route", view);
  if (!decision.ok) { blocked("import-route", decision.reason ?? "无法导入"); return; }
  const pick = bridge().selectRouteFile;
  if (pick === undefined) { show("当前桌面程序不能选择航迹文件"); return; }
  button.disabled = true;
  try {
    const selected = await pick();
    if (selected.ok !== true || typeof selected.fileName !== "string" || selected.bytes === undefined) return;
    const imported = deepUnwrap(await bridge().invoke("route-import", { fileName: selected.fileName, bytes: selected.bytes }), "status");
    const status = read(imported, "status");
    const routeId = read(read(imported, "route"), "routeId");
    if (status !== "imported" || typeof routeId !== "string") {
      const error = read(imported, "error");
      const detail = typeof read(error, "message") === "string"
        ? read(error, "message") as string
        : typeof read(error, "code") === "string"
          ? `（${read(error, "code") as string}）`
          : "";
      show(detail.length > 0 ? `航线导入失败${detail.startsWith("（") ? detail : `：${detail}`}` : "航线导入失败，请确认是 Wayline 导出的 KML/KMZ");
      await render();
      return;
    }
    await bridge().invoke("route-select", { routeId });
    show(read(imported, "duplicate") === true ? "该航线已经导入过，已重新选中。" : `已导入 ${selected.fileName}`);
    await render();
  } finally {
    button.disabled = false;
  }
});

el("route-locate").addEventListener("click", () => { locateDrawnRoute(); });
el("route-remove").addEventListener("click", async () => {
  const view = await projectView();
  const routeId = view.selectedRoute?.routeId;
  if (routeId === undefined || routeId === null) { show("请先选择要删除的航线"); return; }
  const decision = OperatorConsole.evaluate("remove-route", view);
  if (!decision.ok) { blocked("remove-route", decision.reason ?? "无法删除"); return; }
  const removed = unwrap(await bridge().invoke("route-remove", { routeId }));
  if (accepted(removed) !== true && read(removed, "ok") === false) {
    show("当前航线无法删除");
    await render();
    return;
  }
  clearRoutePreview();
  const remaining = await projectView();
  const next = remaining.routes.find((route) => route.routeId !== routeId);
  if (next !== undefined) await bridge().invoke("route-select", { routeId: next.routeId });
  show(next !== undefined ? `已删除，当前为 ${next.displayName}` : "已删除当前航线");
  await render();
});

  document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    const action = (button as HTMLButtonElement).dataset.action ?? "";
    const view = await projectView();
    if (action === "mission-start") {
      await requestMissionStartConfirmation(view);
      return;
    }
    if (action === "hardware-readiness") {
      if (view.missionDeviceId === null) { show("请先选择任务飞机"); return; }
      show(operatorNotice(await bridge().invoke("hardware-readiness", { deviceId: view.missionDeviceId })));
      return;
    }
    const streamAction = action.startsWith("stream-");
    const deviceId = streamAction ? view.streamDeviceId : view.missionDeviceId;
    if (action === "stream-select") {
      await run(action, "stream-select", { deviceId });
      show("图传已选中，等待本页出画");
      return;
    }
    if (action === "stream-stop") detachVideo();
    const names: Record<string, string> = {
      "mission-stage": "mission-stage",
      "mission-upload": "mission-upload",
      "mission-start": "mission-start",
      "mission-pause": "mission-pause",
      "mission-resume": "mission-resume",
      "mission-stop": "mission-stop",
      "stream-start": "stream-start",
      "stream-stop": "stream-stop",
      "flight-takeoff": "flight-request",
      "flight-land": "flight-request",
      "flight-return-home": "flight-request",
    };
    const invokeName = names[action];
    if (invokeName === undefined) return;
    const input = invokeName === "flight-request"
      ? { deviceId, action: action.replace("flight-", "") }
      : { deviceId };
    if (action === "mission-stage" && view.selectedRoute !== null && deviceId !== null) {
      const assigned = unwrap(await bridge().invoke("assignment-assign", { deviceId, routeId: view.selectedRoute.routeId }));
      if (!accepted(assigned)) {
        blocked("assignment-assign", "航线未能赋给所选手机，未开始传输");
        return;
      }
    }
     await run(action, invokeName, input);
  });
});

el("confirm-yes").addEventListener("click", async () => {
  await run("flight-confirm", "flight-confirm", { deviceId: el("confirm").dataset.deviceId, confirmationId: el("confirm").dataset.confirmationId });
});
el("confirm-no").addEventListener("click", async () => {
  await run("flight-cancel", "flight-cancel", { deviceId: el("confirm").dataset.deviceId, confirmationId: el("confirm").dataset.confirmationId });
});
el("mission-confirm-yes").addEventListener("click", () => { void confirmMissionStart(); });
el("mission-confirm-no").addEventListener("click", () => { pendingMissionStart = null; void render(); });

const tick = async (): Promise<void> => {
   try {
     await bridge().invoke("stream-refresh");
     await render();
    await ensurePlayback(await projectView());
  } catch {
    show("界面刷新失败，请检查手机是否仍连接；若持续出现请重启软件");
  }
  window.setTimeout(() => { void tick(); }, 800);
};
void tick();
