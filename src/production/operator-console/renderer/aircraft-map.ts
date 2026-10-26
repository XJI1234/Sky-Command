import { screenHeadingRotation, type AircraftPosition } from "./aircraft-position.js";

type CesiumApi = typeof import("cesium");
type Viewer = import("cesium").Viewer;
const aircraftImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><path fill="white" stroke="#13212b" stroke-width="1.5" d="M20 2 24 16 36 24 35 28 23 24 23 32 28 36 28 39 20 36 12 39 12 36 17 32 17 24 5 28 4 24 16 16Z"/></svg>')}`;
const unknownImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="12" fill="white" stroke="#13212b" stroke-width="3"/><circle cx="20" cy="20" r="3" fill="#13212b"/></svg>')}`;
const statusText = (status: AircraftPosition["status"]): string => ({ live: "实时位置", stale: "位置已过期", disconnected: "已断连 · 最后位置", unknown: "位置时效未知 · 请更新 Relay" })[status];

export function createAircraftMapOverlay() {
  let currentViewer: Viewer | undefined;
  let source: import("cesium").CustomDataSource | undefined;
  let handler: import("cesium").ScreenSpaceEventHandler | undefined;
  let panel: HTMLElement | undefined;
  let details: HTMLElement | undefined;
  let inspectedId: string | null = null;
  let latest: readonly AircraftPosition[] = [];
  const drawn = new Map<string, string>();
  let removePreRender: (() => void) | undefined;
  const rotations = new Map<string, { position: import("cesium").Cartesian3; heading: number; property: import("cesium").ConstantProperty }>();

  const showDetails = (): void => {
    const item = latest.find((entry) => entry.deviceId === inspectedId);
    if (panel === undefined || details === undefined) return;
    panel.hidden = item === undefined;
    if (item === undefined) return;
    const updated = item.updatedAtMs === null ? "未知" : new Date(item.updatedAtMs).toLocaleString();
    details.textContent = [
      item.label, statusText(item.status),
      `经度：${item.longitude.toFixed(7)}°`, `纬度：${item.latitude.toFixed(7)}°`,
      `相对起飞点高度：${item.altitudeMeters === null ? "不可用" : `${item.altitudeMeters.toFixed(1)} 米`}`,
      `机头航向：${item.headingDegrees === null ? "不可用" : `${item.headingDegrees.toFixed(1)}°`}`,
      `位置更新时间：${updated}`, "地图高度：平面定位，高度基准待核实",
      "此处仅查看，不改变任务执行对象。",
    ].join("\n");
  };

  const dispose = (): void => {
    removePreRender?.(); removePreRender = undefined; rotations.clear();
    handler?.destroy(); handler = undefined;
    panel?.remove(); panel = undefined; details = undefined;
    if (source !== undefined && currentViewer !== undefined && !currentViewer.isDestroyed()) currentViewer.dataSources.remove(source, true);
    source = undefined; currentViewer = undefined; drawn.clear();
  };

  const attach = (Cesium: CesiumApi, viewer: Viewer): void => {
    if (currentViewer === viewer) return;
    dispose();
    currentViewer = viewer;
    source = new Cesium.CustomDataSource("aircraft-positions");
    void viewer.dataSources.add(source);
    // Constant properties preserve request-render idle behavior. Reproject only on actual frames.
    removePreRender = viewer.scene.preRender.addEventListener(() => {
      for (const { position, heading, property } of rotations.values()) {
        const angle = Cesium.Math.toRadians(heading);
        const local = new Cesium.Cartesian3(Math.sin(angle) * 100, Math.cos(angle) * 100, 0);
        const ahead = Cesium.Matrix4.multiplyByPoint(Cesium.Transforms.eastNorthUpToFixedFrame(position), local, new Cesium.Cartesian3());
        const a = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, position);
        const b = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, ahead);
        if (a !== undefined && b !== undefined) property.setValue(screenHeadingRotation(b.x - a.x, b.y - a.y));
      }
    });
    panel = document.createElement("section");
    panel.className = "aircraft-map-info";
    panel.setAttribute("aria-label", "飞机位置信息");
    panel.style.cssText = "position:absolute;top:12px;right:12px;z-index:10;max-width:min(340px,90%);padding:14px;background:#14202def;color:#fff;border:1px solid #64859b;border-radius:8px;font:13px/1.8 system-ui;box-shadow:0 3px 18px #0006";
    panel.hidden = true;
    const close = document.createElement("button");
    close.type = "button"; close.textContent = "关闭"; close.setAttribute("aria-label", "关闭飞机位置信息");
    close.style.cssText = "float:right;margin-left:12px;cursor:pointer";
    close.addEventListener("click", () => { inspectedId = null; showDetails(); });
    details = document.createElement("div"); details.style.whiteSpace = "pre-line";
    panel.append(close, details);
    viewer.container.append(panel);
    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((event: { position: import("cesium").Cartesian2 }) => {
      const picked = viewer.scene.pick(event.position) as { id?: { id?: string } } | undefined;
      const id = picked?.id?.id;
      if (typeof id !== "string" || !id.startsWith("aircraft:")) return;
      inspectedId = latest.find((item) => `aircraft:${item.deviceId}` === id)?.deviceId ?? null;
      showDetails();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  };

  return {
    update(viewer: Viewer | undefined, items: readonly AircraftPosition[]): void {
      latest = items;
      if (viewer === undefined || viewer.isDestroyed()) return;
      const Cesium = (globalThis as unknown as { Cesium: CesiumApi }).Cesium;
      attach(Cesium, viewer);
      let changed = false;
      const present = new Set(items.map((item) => item.deviceId));
      for (const id of drawn.keys()) {
        if (!present.has(id)) { source!.entities.removeById(`aircraft:${id}`); drawn.delete(id); rotations.delete(id); changed = true; }
      }
      for (const item of items) {
        const signature = JSON.stringify(item);
        if (drawn.get(item.deviceId) === signature) continue;
        const id = `aircraft:${item.deviceId}`;
        source!.entities.removeById(id);
        const position = Cesium.Cartesian3.fromDegrees(item.longitude, item.latitude, 0);
        const heading = item.headingDegrees;
        const color = Cesium.Color.fromCssColorString(item.status !== "live" ? "#a9b2bc" : item.selected ? "#ffda6a" : "#53d8ef");
        const rotation = new Cesium.ConstantProperty(0);
        rotations.delete(item.deviceId);
        if (heading !== null) rotations.set(item.deviceId, { position, heading, property: rotation });
        source!.entities.add({
          id, name: item.label, position,
          billboard: { image: heading === null ? unknownImage : aircraftImage, width: item.selected ? 40 : 32, height: item.selected ? 40 : 32,
            color, rotation, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
          label: { text: `${item.label}${item.selected ? " · 当前选中" : ""}\n${statusText(item.status)} · 平面定位`, font: "12px sans-serif",
            fillColor: color, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -30), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        });
        drawn.set(item.deviceId, signature); changed = true;
      }
      showDetails();
      if (changed) viewer.scene.requestRender();
    },
    dispose,
  };
}
