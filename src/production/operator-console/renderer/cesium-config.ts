type CesiumApi = typeof import("cesium");

export type TianDiTuProxySettings = {
  readonly imageryUrl: string;
  readonly annotationUrl: string;
};

export function createOrbitViewerOptions(): import("cesium").Viewer.ConstructorOptions {
  return {
    animation: false,
    timeline: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    scene3DOnly: true,
    skyBox: false,
    skyAtmosphere: false,
    baseLayer: false,
  };
}

export function attachWaylineImagery(Cesium: CesiumApi, viewer: import("cesium").Viewer, tianDiTu?: TianDiTuProxySettings): "tianditu" | "esri" {
  viewer.imageryLayers.removeAll();
  if (tianDiTu !== undefined) {
    viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
      url: tianDiTu.imageryUrl,
      credit: new Cesium.Credit("Map data (c) National Geomatics Center of China"),
    }));
    viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
      url: tianDiTu.annotationUrl,
      credit: new Cesium.Credit("Map labels (c) National Geomatics Center of China"),
    }));
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#1d2e36");
    return "tianditu";
  }
  viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    credit: new Cesium.Credit("Tiles (c) Esri"),
  }));
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#1d2e36");
  return "esri";
}
