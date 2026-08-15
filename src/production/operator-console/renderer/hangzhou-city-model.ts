type CesiumApi = typeof import("cesium");

export const hangzhouCityCameraView = {
  longitude: 120.16654968261719,
  latitude: 30.321480751037598,
  height: 4_000,
  heading: 0.45,
  pitch: -Math.PI / 4,
  roll: 0,
};

export function hangzhouTilesetUrl(baseUrl: string): string {
  return new URL("city-tiles/hangzhou/tileset.json", baseUrl).href;
}

export function setHangzhouCamera(Cesium: CesiumApi, viewer: import("cesium").Viewer): void {
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      hangzhouCityCameraView.longitude,
      hangzhouCityCameraView.latitude,
      hangzhouCityCameraView.height,
    ),
    orientation: {
      heading: hangzhouCityCameraView.heading,
      pitch: hangzhouCityCameraView.pitch,
      roll: hangzhouCityCameraView.roll,
    },
  });
  viewer.scene.requestRender();
}

export function frameHangzhouModel(Cesium: CesiumApi, viewer: import("cesium").Viewer, tileset: import("cesium").Cesium3DTileset): void {
  const offset = new Cesium.HeadingPitchRange(
    hangzhouCityCameraView.heading,
    hangzhouCityCameraView.pitch,
    tileset.boundingSphere.radius * 1.35,
  );
  viewer.camera.flyToBoundingSphere(tileset.boundingSphere, { duration: 0.8, offset });
  viewer.scene.requestRender();
}

export async function loadHangzhouCityModel(Cesium: CesiumApi, viewer: import("cesium").Viewer, baseUrl = document.baseURI): Promise<import("cesium").Cesium3DTileset> {
  const tileset = await Cesium.Cesium3DTileset.fromUrl(hangzhouTilesetUrl(baseUrl), {
    maximumScreenSpaceError: 12,
    skipLevelOfDetail: true,
    preferLeaves: true,
    dynamicScreenSpaceError: true,
  });
  viewer.scene.primitives.add(tileset);
  return tileset;
}
