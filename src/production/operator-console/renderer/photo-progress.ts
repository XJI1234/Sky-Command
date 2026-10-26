const stages = ["preparing", "listing", "downloading", "receiving", "verifying", "saving", "saved", "completed", "empty", "failed", "stopped", "disconnected"] as const;
type PhotoStage = typeof stages[number];

export interface PhotoProgressView {
  readonly stage: PhotoStage;
  readonly active: boolean;
  readonly heading: string;
  readonly count: string;
  readonly fileName: string;
  readonly timing: string;
  readonly transfer: string | null;
  readonly percent: number | null;
  readonly history: readonly string[];
  readonly error: string | null;
  readonly announcementKey: string;
}

const read = (source: unknown, key: string): unknown => {
  if (source === null || typeof source !== "object" || Array.isArray(source)) return undefined;
  try { return (source as Record<string, unknown>)[key]; } catch { return undefined; }
};
const nonnegative = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const integer = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const safeText = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 && value.length <= 4096 && !/[\p{Cc}]/u.test(value) ? value : null;
const stageOf = (value: unknown): PhotoStage | null => typeof value === "string" && stages.includes(value as PhotoStage) ? value as PhotoStage : null;
const terminal = (stage: PhotoStage): boolean => stage === "completed" || stage === "empty" || stage === "failed" || stage === "stopped" || stage === "disconnected";
const stageText = (stage: PhotoStage, index: number): string => {
  const current = index > 0 ? `第 ${index} 张：` : "";
  switch (stage) {
    case "preparing": return "正在检查电脑已有照片";
    case "listing": return "正在读取飞机照片列表";
    case "downloading": return `${current}飞机 → 手机`;
    case "receiving": return `${current}手机 → 电脑`;
    case "verifying": return `${current}校验原图`;
    case "saving": return `${current}保存原图`;
    case "saved": return index > 0 ? `第 ${index} 张已保存` : "原图已保存";
    case "completed": return "回传完成";
    case "empty": return "飞机上没有电脑缺少的照片";
    case "failed": return "回传失败";
    case "stopped": return "回传已停止";
    case "disconnected": return "连接已断开，回传中断";
  }
};
const duration = (milliseconds: number): string => {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} 分 ${seconds % 60} 秒` : `${Math.floor(minutes / 60)} 时 ${minutes % 60} 分 ${seconds % 60} 秒`;
};
const clockText = (milliseconds: number): string => new Date(milliseconds).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
const bytesText = (bytes: number): string => bytes < 1024 ? `${Math.round(bytes)} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export interface PhotoProgressCache {
  readonly observe: (devices: readonly unknown[], nowMs: number) => void;
  readonly get: (deviceId: string | null) => unknown;
  readonly deviceIds: () => readonly string[];
}

/** Keeps photo evidence when the workflow removes an offline device; cached rows never authorize a command. */
export function createPhotoProgressCache(): PhotoProgressCache {
  const photos = new Map<string, Record<string, unknown>>();
  const observe = (devices: readonly unknown[], nowMs: number): void => {
    const online = new Set<string>();
    for (const device of devices) {
      const deviceId = safeText(read(device, "deviceId"));
      if (deviceId === null) continue;
      if (read(read(device, "connection"), "relay") !== "offline") online.add(deviceId);
      const photo = read(device, "photo");
      const incoming = photoProgressView(photo, nowMs);
      if (incoming === null) {
        const phase = safeText(read(photo, "phase"));
        const code = safeText(read(photo, "code"));
        const cached = photos.get(deviceId);
        const cachedProgress = cached?.progress;
        const cachedStage = stageOf(read(cachedProgress, "stage"));
        if (online.has(deviceId) && cached !== undefined && cachedStage !== null && !terminal(cachedStage) && phase !== null && phase !== "fetching" && phase !== "capturing") {
          const atMs = Math.max(nonnegative(read(cachedProgress, "updatedAtMs")) ?? nowMs, nowMs);
          const history = Array.isArray(read(cachedProgress, "history")) ? read(cachedProgress, "history") as unknown[] : [];
          const stage = code === "STOPPED" ? "stopped" : phase === "stored" ? "completed" : "failed";
          const event = { stage, photoIndex: read(cachedProgress, "photoIndex"), completedCount: read(cachedProgress, "completedCount"), fileName: read(cachedProgress, "fileName"), atMs };
          photos.set(deviceId, {
            ...cached,
            phase,
            code,
            progress: { ...(cachedProgress as Record<string, unknown>), stage, updatedAtMs: atMs, finishedAtMs: atMs, history: [...history, event].slice(-8) },
          });
        }
        continue;
      }
      if (!online.has(deviceId) && incoming.active && photos.has(deviceId)) continue;
      // New authoritative batches replace the full cache, including prior history and errors.
      const progress = read(photo, "progress") as Record<string, unknown>;
      const history = read(progress, "history");
      photos.set(deviceId, {
        ...(photo as Record<string, unknown>),
        progress: { ...progress, history: Array.isArray(history) ? history.map(event => ({ ...event })) : [] },
      });
    }
    for (const [deviceId, photo] of photos) {
      if (online.has(deviceId)) continue;
      const progress = photo.progress as Record<string, unknown>;
      const stage = stageOf(progress.stage);
      if (stage === null || terminal(stage)) continue;
      const atMs = Math.max(nonnegative(progress.updatedAtMs) ?? nowMs, nowMs);
      const history = Array.isArray(progress.history) ? progress.history : [];
      const event = { stage: "disconnected", photoIndex: progress.photoIndex, completedCount: progress.completedCount, fileName: progress.fileName, atMs };
      photos.set(deviceId, {
        ...photo,
        code: "DISCONNECTED",
        progress: { ...progress, stage: "disconnected", failedStage: stage, updatedAtMs: atMs, finishedAtMs: atMs, history: [...history, event].slice(-8) },
      });
    }
  };
  return Object.freeze({ observe, get: (deviceId: string | null): unknown => deviceId === null ? undefined : photos.get(deviceId), deviceIds: (): readonly string[] => [...photos.keys()] });
}

/** Reads only the authoritative per-device photo batch snapshot; it never infers work from a request receipt. */
export function photoProgressView(photo: unknown, nowMs: number): PhotoProgressView | null {
  const progress = read(photo, "progress");
  const stage = stageOf(read(progress, "stage"));
  const photoIndex = integer(read(progress, "photoIndex"));
  const completedCount = integer(read(progress, "completedCount"));
  const startedAtMs = nonnegative(read(progress, "startedAtMs"));
  const updatedAtMs = nonnegative(read(progress, "updatedAtMs"));
  if (stage === null || photoIndex === null || completedCount === null || startedAtMs === null || updatedAtMs === null) return null;
  const active = !terminal(stage);
  const finishedAtMs = nonnegative(read(progress, "finishedAtMs"));
  const elapsedEnd = active ? nowMs : finishedAtMs ?? updatedAtMs;
  const age = Math.max(0, nowMs - updatedAtMs);
  const timing = active
    ? `已用时 ${duration(elapsedEnd - startedAtMs)} · ${age < 1000 ? "刚刚更新" : `${duration(age)}前更新`}`
    : `用时 ${duration(elapsedEnd - startedAtMs)} · 最后更新 ${clockText(updatedAtMs)}`;
  const historySource = read(progress, "history");
  const events = Array.isArray(historySource) ? historySource.slice(-8) : [];
  const history = events.flatMap((event): string[] => {
    const eventStage = stageOf(read(event, "stage"));
    const index = integer(read(event, "photoIndex"));
    const atMs = nonnegative(read(event, "atMs"));
    if (eventStage === null || index === null || atMs === null) return [];
    const fileName = safeText(read(event, "fileName"));
    return [`${clockText(atMs)} · ${stageText(eventStage, index)}${fileName === null ? "" : ` · ${fileName}`}`];
  });
  const failedStage = stageOf(read(progress, "failedStage")) ?? events.map(event => stageOf(read(event, "stage"))).reverse().find(value => value !== null && !terminal(value));
  const failure = stage === "failed" || stage === "disconnected";
  const heading = `${stageText(stage, photoIndex)}${failure && failedStage !== undefined && failedStage !== null ? `（${stageText(failedStage, photoIndex)}）` : ""}`;
  const transferredBytes = nonnegative(read(progress, "transferredBytes"));
  const totalBytes = nonnegative(read(progress, "totalBytes"));
  const hasTransfer = (stage === "downloading" || stage === "receiving") && transferredBytes !== null && totalBytes !== null && totalBytes > 0;
  const percent = hasTransfer ? Math.floor(Math.min(100, transferredBytes / totalBytes * 100)) : null;
  const platformError = read(progress, "platformError");
  const errorCode = safeText(read(platformError, "code"));
  const description = safeText(read(platformError, "description"));
  const code = safeText(read(photo, "code"));
  const error = failure ? [code === null ? null : `回传结果：${code}`, errorCode === null ? null : `错误码：${errorCode}`, description === null ? null : `错误说明：${description}`].filter(value => value !== null).join("\n") || null : null;
  return {
    stage,
    active,
    heading,
    count: `累计已保存 ${completedCount} 张原图`,
    fileName: safeText(read(progress, "fileName")) ?? "尚未取得文件名",
    timing,
    transfer: hasTransfer ? `本张本阶段 ${bytesText(transferredBytes)} / ${bytesText(totalBytes)} · ${percent}%` : null,
    percent,
    history,
    error,
    announcementKey: `${startedAtMs}:${stage}:${photoIndex}:${code ?? ""}:${heading}`,
  };
}

type PhotoProgressNodes = {
  readonly stage: HTMLElement;
  readonly count: HTMLElement;
  readonly fileName: HTMLElement;
  readonly timing: HTMLElement;
  readonly transfer: HTMLElement;
  readonly meter: HTMLProgressElement;
  readonly history: HTMLDetailsElement;
  readonly historyList: HTMLOListElement;
  readonly error: HTMLDetailsElement;
  readonly errorText: HTMLElement;
  historyKey: string;
  announcementKey: string;
};
const mounted = new WeakMap<HTMLElement, PhotoProgressNodes>();
const setText = (node: HTMLElement, value: string): void => { if (node.textContent !== value) node.textContent = value; };
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  return node;
};
const mount = (host: HTMLElement): PhotoProgressNodes => {
  host.classList.add("photo-batch-progress");
  host.setAttribute("aria-label", "照片回传进度");
  const title = element("h3", "photo-progress-title");
  title.textContent = "照片回传";
  const stage = element("p", "photo-progress-stage");
  stage.setAttribute("aria-live", "polite");
  stage.setAttribute("aria-atomic", "true");
  const count = element("p", "photo-progress-count");
  const fileName = element("p", "photo-progress-file");
  const timing = element("p", "photo-progress-timing");
  const transfer = element("p", "photo-progress-transfer");
  const meter = element("progress", "photo-progress-meter");
  meter.max = 100;
  meter.setAttribute("aria-label", "当前照片当前传输阶段进度");
  const history = element("details", "photo-progress-history");
  history.open = true;
  const historySummary = element("summary", "");
  historySummary.textContent = "最近阶段";
  const historyList = element("ol", "photo-progress-events");
  history.append(historySummary, historyList);
  const error = element("details", "photo-progress-error");
  const errorSummary = element("summary", "");
  errorSummary.textContent = "错误详情";
  const errorText = element("p", "");
  error.append(errorSummary, errorText);
  host.replaceChildren(title, stage, count, fileName, timing, transfer, meter, history, error);
  const nodes = { stage, count, fileName, timing, transfer, meter, history, historyList, error, errorText, historyKey: "", announcementKey: "" };
  mounted.set(host, nodes);
  return nodes;
};

export function renderPhotoProgress(host: HTMLElement, view: PhotoProgressView | null, idleMessage = "尚未开始回传照片"): void {
  const nodes = mounted.get(host) ?? mount(host);
  host.dataset.photoStage = view?.stage ?? "idle";
  const announcementKey = view?.announcementKey ?? `idle:${idleMessage}`;
  // Stage/index transitions announce once; byte chunks and clock updates are quiet.
  if (nodes.announcementKey !== announcementKey) {
    setText(nodes.stage, view?.heading ?? idleMessage);
    nodes.announcementKey = announcementKey;
  }
  for (const node of [nodes.count, nodes.fileName, nodes.timing]) node.hidden = view === null;
  setText(nodes.count, view?.count ?? "");
  setText(nodes.fileName, view === null ? "" : `文件：${view.fileName}`);
  setText(nodes.timing, view?.timing ?? "");
  nodes.transfer.hidden = view?.transfer === null || view === null;
  nodes.meter.hidden = view?.percent === null || view === null;
  setText(nodes.transfer, view?.transfer ?? "");
  if (view?.percent !== null && view?.percent !== undefined) nodes.meter.value = view.percent;
  nodes.history.hidden = view === null || view.history.length === 0;
  const historyKey = JSON.stringify(view?.history ?? []);
  if (nodes.historyKey !== historyKey) {
    nodes.historyList.replaceChildren(...(view?.history ?? []).map(item => {
      const event = document.createElement("li");
      event.textContent = item;
      return event;
    }));
    nodes.historyKey = historyKey;
  }
  nodes.error.hidden = view?.error === null || view === null;
  setText(nodes.errorText, view?.error ?? "");
}
