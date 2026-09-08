import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nanjingCityCameraView, nanjingTilesetUrl } from "../src/production/operator-console/renderer/hangzhou-city-model.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("航线页城市白模", () => {
  it("把默认三维白模指向南京分块 tileset", () => {
    expect(nanjingTilesetUrl("http://127.0.0.1:5173/")).toBe("http://127.0.0.1:5173/city-tiles/nanjing/tileset.json");
  });

  it("默认相机落在南京城区而不是杭州", () => {
    expect(nanjingCityCameraView.longitude).toBeCloseTo(118.778, 2);
    expect(nanjingCityCameraView.latitude).toBeCloseTo(32.043, 2);
    expect(nanjingCityCameraView.height).toBe(4_000);
  });

  it("仓库内存在已转换的南京 3D Tiles", async () => {
    await access(join(repoRoot, "public/city-tiles/nanjing/tileset.json"));
  });
});
