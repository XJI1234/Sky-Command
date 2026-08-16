import Hls from "hls.js";
import { OperatorConsole } from "../index.js";
import { clearRoutePreview, drawnPreviewId, ensureRouteMap, locateDrawnRoute, resizeRouteMap, routeMapNotice, showRoutePreview, type RouteMapPreview } from "./route-map.js";

type WorkspaceName = "devices" | "routes" | "flight";

const state: { workspace: WorkspaceName; missionDeviceId: string | null; streamDeviceId: string | null } = {
  workspace: "devices",
  missionDeviceId: null,
  streamDeviceId: null,
};

const bridge = (): {
  invoke: (name: string, input?: unknown) => Promise<unknown>;
  relayHint?: string;
  incidentLog?: string;
  selectRouteFile?: () => Promise<{ ok?: boolean; fileName?: string; bytes?: Uint8Array }>;
} => {
  const api = (window as unknown as { skyCommand?: {
    invoke: (name: string, input?: unknown) => Promise<unknown>;
    relayHint?: string;
    incidentLog?: string;
    selectRouteFile?: () => Promise<{ ok?: boolean; fileName?: string; bytes?: Uint8Array }>;
  } }).skyCommand;
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

let hlsPlayer: Hls | null = null;
let attachedUrl: string | null = null;

const detachVideo = (): void => {
  const video = el("video") as HTMLVideoElement;
  hlsPlayer?.destroy();
  hlsPlayer = null;
  attachedUrl = null;
  video.removeAttribute("src");
  video.load();
};

const attachVideo = (url: string): void => {
  const video = el("video") as HTMLVideoElement;
  if (attachedUrl === url && hlsPlayer !== null) {
    void video.play().catch(() => undefined);
    return;
  }
  detachVideo();
  attachedUrl = url;
  const play = (): void => { void video.play().catch(() => undefined); };
  if (Hls.isSupported()) {
    hlsPlayer = new Hls({ enableWorker: true, lowLatencyMode: true });
    hlsPlayer.on(Hls.Events.MANIFEST_PARSED, play);
    hlsPlayer.loadSource(url);
    hlsPlayer.attachMedia(video);
    return;
  }
  video.src = url;
  play();
};

const accepted = (value: unknown): boolean => value !== null && typeof value === "object" && (value as { ok?: unknown }).ok === true;

const playbackUrl = (value: unknown): string | null => {
  const url = read(read(value, "value"), "url") ?? read(value, "url");
  return typeof url === "string" && url.length > 0 ? url : null;
};

async function ensurePlayback(view: ReturnType<typeof OperatorConsole.project>): Promise<void> {
  if (!view.playbackReady) return;
  const deviceId = view.playingVideoDeviceId ?? view.streamDeviceId;
  if (deviceId === null) return;
  const playback = unwrap(await bridge().invoke("video-playback", { deviceId }));
  const url = playbackUrl(playback);
  if (url !== null) attachVideo(url);
}

const connectionLabel = (connection: unknown, key: string, ok: string, wait: string): string => {
  const value = read(connection, key);
  if (value === "ready" || value === "connected" || value === "online") return ok;
  return wait;
};

const connected = (connection: unknown, key: string): boolean => {
  const value = read(connection, key);
  return value === "ready" || value === "connected" || value === "online";
};

const pairingFact = (connection: unknown): { readonly label: string; readonly ok: boolean } => {
  switch (read(connection, "pairingState")) {
    case "PAIRED": return { label: "已对频", ok: true };
    case "PAIRING": return { label: "对频中", ok: false };
    case "STOPPING": return { label: "正在结束对频", ok: false };
    case "FAILED": return { label: "对频失败", ok: false };
    case "IDLE": return { label: "未对频", ok: false };
    default: return { label: "未对频", ok: false };
  }
};

const extraFacts = (connection: unknown): string => {
  const battery = read(connection, "batteryPercent");
  const parts = [typeof battery === "number" ? `电量 ${battery}%` : "电量尚未取得"];
  const flightState = read(connection, "flightState");
  if (flightState === "flying") parts.push("飞机在空中");
  if (flightState === "grounded") parts.push("飞机在地面");
  const pose = read(connection, "pose");
  const latitude = read(pose, "latitude");
  const longitude = read(pose, "longitude");
  const altitude = read(pose, "altitudeMeters");
  if (typeof latitude === "number" && typeof longitude === "number") {
    parts.push(`位置 ${latitude.toFixed(5)}, ${longitude.toFixed(5)}${typeof altitude === "number" ? ` · 高度 ${altitude} m` : ""}`);
  }
  return parts.join(" · ");
};

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
  show(JSON.stringify(unwrap(await bridge().invoke(invokeName, input))));
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
    node.innerHTML = `<strong>${String(device.deviceId)}</strong><div class="muted">${connectionLabel(connection, "remoteController", "遥控器已连接", "等待遥控器")} · ${pairing.label} · ${connectionLabel(connection, "aircraft", "飞机已连接", "等待飞机")}</div>`;
    node.addEventListener("click", () => { state.missionDeviceId = String(device.deviceId); void render(); });
    return node;
  }));
  const inspected = devices.find((item) => item.deviceId === view.missionDeviceId);
  const connection = inspected === undefined ? {} : inspected.connection as Record<string, unknown> ?? {};
  const pairing = pairingFact(connection);
  el("device-detail").innerHTML = inspected === undefined
    ? "从左侧选择已连接的手机。"
    : `<p class="muted">编号 ${String(inspected.deviceId)}</p>
      <div class="chain">
        <span class="ok">手机已连接</span>
        <span class="${connected(connection, "remoteController") ? "ok" : ""}">${connectionLabel(connection, "remoteController", "遥控器已连接", "等待遥控器")}</span>
        <span class="${pairing.ok ? "ok" : ""}">${pairing.label}</span>
        <span class="${connected(connection, "aircraft") ? "ok" : ""}">${connectionLabel(connection, "aircraft", "飞机已连接", "等待飞机")}</span>
      </div>
      <p>${extraFacts(connection)}</p>
      <p class="muted">对频请在手机上开始或停止。这里只显示手机回报的结果。</p>`;
  el("device-guide").textContent = `电脑和手机连同一 Wi-Fi。在手机上填写 ${view.relayHint}，点保存并启动。遥控器连上后，请在手机上开始对频，再等飞机连上。电脑关掉后，需要在手机上重新连接。`;
}

function renderRoutes(view: ReturnType<typeof OperatorConsole.project>): void {
  const selected = view.selectedRoute;
  const hasRoute = selected !== null && selected !== undefined;
  el("route-picker-wrap").hidden = !hasRoute;
  el("route-details").hidden = !hasRoute;
  el("route-empty").hidden = hasRoute;
  const select = el("route-select") as HTMLSelectElement;
  select.replaceChildren(...view.routes.map((route) => Object.assign(document.createElement("option"), {
    value: route.routeId,
    textContent: route.displayName,
    selected: selected?.routeId === route.routeId,
  })));
  select.onchange = async () => {
    const decision = OperatorConsole.evaluate("select-route", view);
    if (!decision.ok) { show(decision.reason ?? "无法选择航线"); return; }
    await bridge().invoke("route-select", { routeId: select.value });
    await render();
  };
  if (selected === null || selected === undefined) {
    el("route-summary").textContent = "尚未导入航迹文件";
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
  const guidance = view.guidance as { message?: string } | null;
  el("guidance").textContent = guidance?.message ?? "";
  const confirm = el("confirm");
  if (view.confirmation !== null) {
    confirm.hidden = false;
    el("confirm-text").textContent = `确认对 ${view.confirmation.deviceId} 执行 ${view.confirmation.action}？停止航线不会自动返航。`;
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
      show(typeof read(imported, "error") === "object" ? "导入失败" : JSON.stringify(imported));
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
  await bridge().invoke("route-remove", { routeId });
  clearRoutePreview();
  show("已删除当前航线");
  await render();
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    const action = (button as HTMLButtonElement).dataset.action ?? "";
    const view = await projectView();
    const deviceId = action.startsWith("stream-") ? view.streamDeviceId : view.missionDeviceId;
    if (action === "stream-select") {
      await run(action, "stream-select", { deviceId });
      const playback = unwrap(await bridge().invoke("video-playback", { deviceId }));
      const url = playbackUrl(playback);
      if (url !== null) attachVideo(url);
      else show(view.streamLabel);
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

const tick = async (): Promise<void> => {
  try {
    await bridge().invoke("stream-refresh");
    await render();
    await ensurePlayback(await projectView());
  } catch (error) { show(String(error)); }
  window.setTimeout(() => { void tick(); }, 800);
};
void tick();
