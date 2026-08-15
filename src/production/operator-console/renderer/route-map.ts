import { attachWaylineImagery, createOrbitViewerOptions } from "./cesium-config.js";
import { frameHangzhouModel, loadHangzhouCityModel, setHangzhouCamera } from "./hangzhou-city-model.js";

type CesiumApi = typeof import("cesium");
type Viewer = import("cesium").Viewer;

export interface RouteMapPreview {
  readonly polyline: readonly { readonly longitude: number; readonly latitude: number; readonly altitude: number | null }[];
  readonly startMarker: { readonly longitude: number; readonly latitude: number; readonly altitude: number | null };
  readonly endMarker: { readonly longitude: number; readonly latitude: number; readonly altitude: number | null };
}

const cesium = (): CesiumApi => {
  const value = (globalThis as { Cesium?: CesiumApi }).Cesium;
  if (value === undefined) throw new Error("Cesium 未加载");
  return value;
};

const positionOf = (Cesium: CesiumApi, point: { readonly longitude: number; readonly latitude: number; readonly altitude: number | null }) =>
  Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, point.altitude ?? 0);

let viewer: Viewer | undefined;
let drawnRouteId: string | null = null;
let drawnPositions: import("cesium").Cartesian3[] = [];
let notice = "导入 Wayline 导出的 KML 或 KMZ 文件以预览航迹。";

export const routeMapNotice = (): string => notice;

export async function ensureRouteMap(host: HTMLElement): Promise<void> {
  if (viewer !== undefined && !viewer.isDestroyed()) {
    viewer.resize();
    return;
  }
  const Cesium = cesium();
  Cesium.Ion.defaultAccessToken = "";
  viewer = new Cesium.Viewer(host, createOrbitViewerOptions());
  const provider = attachWaylineImagery(Cesium, viewer);
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 20;
  viewer.scene.screenSpaceCameraController.enableTilt = true;
  setHangzhouCamera(Cesium, viewer);
  try {
    const cityModel = await loadHangzhouCityModel(Cesium, viewer);
    if (viewer === undefined || viewer.isDestroyed()) return;
    frameHangzhouModel(Cesium, viewer, cityModel);
    notice = `杭州三维白模已加载，当前底图：${provider === "tianditu" ? "天地图影像" : "Esri 卫星图"}。导入 Wayline 导出的 KML 或 KMZ 文件以叠加航迹。`;
  } catch (error) {
    notice = `杭州三维白模加载失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

export function resizeRouteMap(): void {
  if (viewer === undefined || viewer.isDestroyed()) return;
  const host = viewer.container as HTMLElement;
  const width = host.clientWidth;
  const height = host.clientHeight;
  if (width < 2 || height < 2) return;
  viewer.resize();
}

export function showRoutePreview(routeId: string, preview: RouteMapPreview, fly = true): void {
  const Cesium = cesium();
  if (viewer === undefined || viewer.isDestroyed()) return;
  viewer.entities.removeAll();
  drawnRouteId = routeId;
  const positions = preview.polyline.map((point) => positionOf(Cesium, point));
  drawnPositions = positions;
  if (positions.length < 2) return;
  viewer.entities.add({
    name: "导入航线",
    polyline: {
      positions,
      width: 5,
      material: Cesium.Color.fromCssColorString("#d7f16a"),
      clampToGround: false,
    },
  });
  viewer.entities.add({
    name: "起点",
    position: positionOf(Cesium, preview.startMarker),
    point: { pixelSize: 12, color: Cesium.Color.fromCssColorString("#d7f16a"), outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
    label: {
      text: "起点",
      font: "12px sans-serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -14),
    },
  });
  viewer.entities.add({
    name: "终点",
    position: positionOf(Cesium, preview.endMarker),
    point: { pixelSize: 12, color: Cesium.Color.fromCssColorString("#ff9f43"), outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
    label: {
      text: "终点",
      font: "12px sans-serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -14),
    },
  });
  if (fly) {
    viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints(positions), {
      duration: 0.8,
      offset: new Cesium.HeadingPitchRange(0, -Math.PI / 2.8, 0),
    });
  }
  notice = `${preview.polyline.length} 个航点`;
}

export function locateDrawnRoute(): void {
  if (viewer === undefined || viewer.isDestroyed() || drawnPositions.length < 2) return;
  const Cesium = cesium();
  viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints(drawnPositions), {
    duration: 0.8,
    offset: new Cesium.HeadingPitchRange(0, -Math.PI / 2.8, 0),
  });
}

export function clearRoutePreview(): void {
  drawnRouteId = null;
  drawnPositions = [];
  if (viewer === undefined || viewer.isDestroyed()) return;
  viewer.entities.removeAll();
}

export function drawnPreviewId(): string | null {
  return drawnRouteId;
}
