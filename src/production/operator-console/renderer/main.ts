import flvjs from "flv.js";
import { OperatorConsole } from "../index.js";
import { DeviceFactSummary } from "../device-fact-summary/index.js";
import { clearRoutePreview, drawnPreviewId, ensureRouteMap, locateDrawnRoute, resizeRouteMap, routeMapNotice, showRoutePreview, type RouteMapPreview } from "./route-map.js";

type WorkspaceName = "devices" | "routes" | "flight";
type WhepListener = (input: unknown) => void;
type RendererBridge = {
  readonly invoke: (name: string, input?: unknown) => Promise<unknown>;
  readonly relayHint?: string;
  readonly incidentLog?: string;
  readonly selectRouteFile?: () => Promise<{ ok?: boolean; fileName?: string; bytes?: Uint8Array }>;
  readonly onWhepSelect?: (listener: WhepListener) => () => void;
  readonly onWhepClear?: (listener: WhepListener) => () => void;
  readonly whepReady?: (generation: number) => void;
  readonly whepFatal?: (generation: number) => void;
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
  if (code === "WEBRTC_MEDIA_UNAVAILABLE" || code === "TARGET_INVALID") return "该图传方式不可用，请使用「启动图传」";
  if (code === "CAPABILITY_BLOCKED") return "当前飞机不支持图传";
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
let whepPeer: RTCPeerConnection | null = null;
let whepGeneration = 0;

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
  closeWhep();
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

const whepTarget = (value: unknown): Readonly<{ readonly generation: number; readonly deviceId: string; readonly url: string }> | null => {
  const generation = read(value, "generation");
  const deviceId = read(value, "deviceId");
  const url = read(value, "url");
  if (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation <= 0 || typeof deviceId !== "string" || deviceId.trim().length === 0 || /[\p{Cc}\\/]/u.test(deviceId) || typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") || parsed.port.length === 0 || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "" || parsed.pathname !== `/live/${encodeURIComponent(deviceId)}/whep`) return null;
    return Object.freeze({ generation, deviceId, url });
  } catch {
    return null;
  }
};

const closeWhep = (): void => {
  const peer = whepPeer;
  whepPeer = null;
  if (peer !== null) {
    peer.ontrack = null;
    peer.onconnectionstatechange = null;
    peer.oniceconnectionstatechange = null;
    try { peer.close(); } catch { /* stale PeerConnection cleanup is best effort */ }
  }
  const video = el("video") as HTMLVideoElement;
  if (flvPlayer !== null || video.srcObject !== null) detachVideo();
};

const waitForIce = async (peer: RTCPeerConnection): Promise<void> => {
  if (peer.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      peer.removeEventListener("icegatheringstatechange", onState);
      window.clearTimeout(timer);
      resolve();
    };
    const onState = (): void => { if (peer.iceGatheringState === "complete") finish(); };
    const timer = window.setTimeout(finish, 5_000);
    peer.addEventListener("icegatheringstatechange", onState);
  });
};

const reportWhepFatal = (generation: number): void => {
  if (generation !== whepGeneration) return;
  try { bridge().whepFatal?.(generation); } catch { /* IPC failure must not escape the render loop */ }
  show("低延迟画面无法接通，请改用「启动图传」");
};

const connectWhep = async (input: unknown): Promise<void> => {
  const target = whepTarget(input);
  if (target === null) {
    const generation = read(input, "generation");
    if (typeof generation === "number" && Number.isSafeInteger(generation)) reportWhepFatal(generation);
    return;
  }
  const token = target.generation;
  whepGeneration = token;
  closeWhep();
  try {
    const peer = new RTCPeerConnection({ iceServers: [] });
    whepPeer = peer;
    peer.addTransceiver("video", { direction: "recvonly" });
    peer.onconnectionstatechange = () => {
      if (whepPeer === peer && (peer.connectionState === "failed" || peer.connectionState === "closed")) reportWhepFatal(token);
    };
    peer.oniceconnectionstatechange = () => {
      if (whepPeer === peer && peer.iceConnectionState === "failed") reportWhepFatal(token);
    };
    peer.ontrack = (event) => {
      if (whepPeer !== peer || token !== whepGeneration) return;
      const video = el("video") as HTMLVideoElement;
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      video.srcObject = stream;
      video.muted = true;
      video.defaultMuted = true;
      video.volume = 0;
      const ready = (): void => {
        if (whepPeer !== peer || token !== whepGeneration) return;
        try { bridge().whepReady?.(token); } catch { /* renderer-to-host IPC is isolated */ }
      };
      video.addEventListener("loadeddata", ready, { once: true });
      void video.play().then(() => { if (video.readyState >= 2) ready(); }).catch(() => { if (video.readyState >= 2) ready(); });
      if (video.readyState >= 2) ready();
    };
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIce(peer);
    if (whepPeer !== peer || token !== whepGeneration) return;
    const sdp = peer.localDescription?.sdp;
    if (typeof sdp !== "string" || sdp.length === 0) throw new Error("WHEP offer missing");
    const response = await fetch(target.url, { method: "POST", headers: { "Content-Type": "application/sdp", Accept: "application/sdp" }, credentials: "omit", body: sdp });
    if (!response.ok) throw new Error("WHEP request failed");
    const answer = await response.text();
    if (answer.trim().length === 0) throw new Error("WHEP answer missing");
    await peer.setRemoteDescription({ type: "answer", sdp: answer });
  } catch {
    if (token !== whepGeneration) return;
    closeWhep();
    reportWhepFatal(token);
  }
};

const clearWhep = (input: unknown): void => {
  const generation = read(input, "generation");
  if (typeof generation === "number" && Number.isSafeInteger(generation) && generation < whepGeneration) return;
  if (typeof generation === "number" && Number.isSafeInteger(generation)) whepGeneration = generation;
  closeWhep();
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
  if (whepPeer !== null) return;
  if (!view.playbackReady) {
    if (attachedUrl !== null) detachVideo();
    return;
  }
  if (view.streamDeviceId === null) return;
  const url = playbackUrl(await bridge().invoke("video-playback", { deviceId: view.streamDeviceId }));
  if (url === null) return;
  attachVideo(url);
  watchPlaybackStall(el("video") as HTMLVideoElement);
}

const connectionLabel = (connection: unknown, key: string, ok: string, disconnected: string, unknownLabel: string): string => {
  const value = read(connection, key);
  if (value === "ready" || value === "connected" || value === "online") return ok;
  if ((key === "remoteController" || key === "aircraft") && read(connection, "sdk") !== "ready") {
    return "等待手机就绪";
  }
  if (value === "disconnected") return disconnected;
  return unknownLabel;
};

const connected = (connection: unknown, key: string): boolean => {
  const value = read(connection, key);
  return value === "ready" || value === "connected" || value === "online";
};

const aircraftLinkLabel = (connection: unknown): string => {
  const aircraft = read(connection, "aircraft");
  const flightController = read(connection, "flightController");
  if (aircraft === "connected" && flightController === "connected") return "飞机已连接";
  if (aircraft === "connected" && flightController === "disconnected") return "飞机已连上，但飞控未通（请确认飞机已开机）";
  if (aircraft === "connected" && flightController !== "connected") return "飞机已连上，飞控状态未知";
  if (aircraft === "disconnected") return "飞机未连接";
  if (read(connection, "sdk") !== "ready") return "等待手机就绪";
  return "飞机状态未知";
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

async function runWebRtcService(invokeName: string): Promise<void> {
  show(operatorNotice(await bridge().invoke(invokeName, undefined)));
  await render();
}

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
    const pairing = pairingFact(connection);
    node.innerHTML = `<strong>${escapeHtml(String(device.deviceId))}</strong><div class="muted">${connectionLabel(connection, "remoteController", "遥控器已连接", "遥控器未连接", "遥控器状态未知")} · ${pairing.label} · ${aircraftLinkLabel(connection)}</div>`;
    node.addEventListener("click", () => { state.missionDeviceId = String(device.deviceId); void render(); });
    return node;
  }));
  const inspected = devices.find((item) => item.deviceId === view.missionDeviceId);
  const connection = inspected === undefined ? {} : inspected.connection as Record<string, unknown> ?? {};
  const pairing = pairingFact(connection);
  el("device-detail").innerHTML = inspected === undefined
    ? "从左侧选择已连接的手机。"
    : `<p class="muted">编号 ${escapeHtml(String(inspected.deviceId))}</p>
      <div class="chain">
        <span class="ok">手机已连接</span>
        <span class="${connected(connection, "remoteController") ? "ok" : ""}">${connectionLabel(connection, "remoteController", "遥控器已连接", "遥控器未连接", "遥控器状态未知")}</span>
        <span class="${pairing.ok ? "ok" : ""}">${pairing.label}</span>
        <span class="${connected(connection, "aircraft") && connected(connection, "flightController") ? "ok" : ""}">${aircraftLinkLabel(connection)}</span>
      </div>
      <p>${escapeHtml(DeviceFactSummary.format(connection))}</p>
      <p class="muted">对频请在手机上开始或停止。这里只显示手机回报的结果。</p>`;
  el("device-guide").textContent = `电脑和手机连同一 Wi-Fi。在手机上填写 ${view.relayHint}，点保存并启动。遥控器连上后，请在手机上开始对频，再等飞机连上。电脑关掉后，需要在手机上重新连接。`;
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
  el("flight-route").textContent = view.selectedRoute === null
    ? "尚未在航线页选择可执行 KMZ"
    : `${view.selectedRoute.displayName} · ${view.selectedRoute.executable ? "可提交" : view.selectedRoute.blockedReason}`;
  el("stream-label").textContent = view.streamLabel;
  el("stream-label").classList.toggle("ok", view.playbackReady || view.streamCanStart);
  const streamReady = el("stream-ready");
  if (view.playbackReady || view.streamCanStop) {
    streamReady.textContent = view.playbackReady
      ? "画面已就绪。要结束请点「停止图传」"
      : `${view.streamLabel}。要结束请点「停止图传」`;
    streamReady.classList.add("ok");
  } else if (view.streamCanStart) {
    streamReady.textContent = "图传可启动：遥控器与飞机已连接，点下方「启动图传」";
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
    startButton.title = view.streamCanStart ? "启动图传" : view.streamLabel;
  }
  const stopButton = document.querySelector('button[data-action="stream-stop"]');
  if (stopButton instanceof HTMLButtonElement) {
    const canStop = view.streamCanStop || attachedUrl !== null;
    stopButton.disabled = !canStop;
    stopButton.title = canStop ? "停止图传" : "当前没有进行中的图传";
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
    if (action === "webrtc-start" || action === "webrtc-stop") {
      await runWebRtcService(action);
      return;
    }
    const view = await projectView();
    if (action === "hardware-readiness") {
      if (view.missionDeviceId === null) { show("请先选择任务飞机"); return; }
      show(operatorNotice(await bridge().invoke("hardware-readiness", { deviceId: view.missionDeviceId })));
      return;
    }
    const streamAction = action.startsWith("stream-") || action.startsWith("webrtc-stream-");
    const deviceId = streamAction ? view.streamDeviceId : view.missionDeviceId;
    if (action === "stream-select") {
      await run(action, "stream-select", { deviceId });
      show("图传已选中，等待本页出画");
      return;
    }
    if (action === "webrtc-stream-clear") {
      closeWhep();
      await runWebRtcService("webrtc-stream-clear");
      return;
    }
    if (action === "webrtc-stream-start") detachVideo();
    if (action === "stream-stop") detachVideo();
    if (action === "webrtc-stream-stop") closeWhep();
    if (action === "webrtc-stream-select") {
      await run("stream-select", "webrtc-stream-select", { deviceId });
      return;
    }
    const names: Record<string, string> = {
      "mission-stage": "mission-stage",
      "mission-upload": "mission-upload",
      "mission-start": "mission-start",
      "mission-pause": "mission-pause",
      "mission-resume": "mission-resume",
      "mission-stop": "mission-stop",
      "stream-start": "stream-start",
      "stream-stop": "stream-stop",
      "webrtc-stream-start": "webrtc-stream-start",
      "webrtc-stream-stop": "webrtc-stream-stop",
      "flight-takeoff": "flight-request",
      "flight-land": "flight-request",
      "flight-return-home": "flight-request",
    };
    const invokeName = names[action];
    if (invokeName === undefined) return;
    const decisionAction = action.startsWith("webrtc-") ? action.slice("webrtc-".length) : action;
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
     await run(decisionAction, invokeName, input);
  });
});

el("confirm-yes").addEventListener("click", async () => {
  await run("flight-confirm", "flight-confirm", { deviceId: el("confirm").dataset.deviceId, confirmationId: el("confirm").dataset.confirmationId });
});
el("confirm-no").addEventListener("click", async () => {
  await run("flight-cancel", "flight-cancel", { deviceId: el("confirm").dataset.deviceId, confirmationId: el("confirm").dataset.confirmationId });
});

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
