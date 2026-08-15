import { describe, expect, it } from "vitest";
import { CityModelCatalog } from "../src/modules/geo-map/city-model/index.js";

const westLake = { id: "west-lake-white-model", displayName: "西湖建筑白模", tilesetUrl: "/models/west-lake/tileset.json" };
const qiantang = { id: "qiantang-white-model", displayName: "钱塘建筑白模", tilesetUrl: "/models/qiantang/tileset.json" };

describe("城市模型目录模块契约", () => {
  it("提供稳定的杭州建筑白模目录", () => {
    const catalog = CityModelCatalog.createHangzhou();

    expect(catalog.list()).toEqual([{ id: "hangzhou-white-model", displayName: "杭州建筑白模", tilesetUrl: "/hangzhou-3dtiles/tileset.json", format: "3d-tiles" }]);
    expect(catalog.resolve("hangzhou-white-model")).toEqual({ ok: true, value: { id: "hangzhou-white-model", displayName: "杭州建筑白模", tilesetUrl: "/hangzhou-3dtiles/tileset.json", format: "3d-tiles" } });
  });

  it("保留自定义目录的顺序并隔离外部输入与每次输出", () => {
    const input = [westLake, qiantang];
    const created = CityModelCatalog.create(input);
    if (!created.ok) throw created.error;
    input[0].displayName = "已篡改";

    const first = created.value.list();
    const second = created.value.list();
    expect(first.map((model) => model.id)).toEqual(["west-lake-white-model", "qiantang-white-model"]);
    expect(first[0].displayName).toBe("西湖建筑白模");
    expect(created.value.resolve("qiantang-white-model")).toMatchObject({ ok: true, value: { displayName: "钱塘建筑白模" } });
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.value)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
  });

  it.each([
    [null, { field: "input", reason: "invalid-container" }],
    [[], { field: "input", reason: "empty" }],
    [Array.from({ length: 33 }, (_, index) => ({ id: `model-${index}`, displayName: "模型", tilesetUrl: "/model/tileset.json" })), { field: "input", reason: "too-many" }],
    [[null], { field: "model", reason: "invalid-type" }],
    [[7], { field: "model", reason: "invalid-type" }],
    [[{ ...westLake, id: "" }], { field: "id", reason: "invalid-id" }],
    [[{ ...westLake, id: "Bad" }], { field: "id", reason: "invalid-id" }],
    [[{ ...westLake, id: "valid-" }], { field: "id", reason: "invalid-id" }],
    [[{ ...westLake, id: "a".repeat(65) }], { field: "id", reason: "invalid-id" }],
    [[westLake, westLake], { field: "id", reason: "duplicate-id" }],
    [[{ ...westLake, displayName: 7 }], { field: "displayName", reason: "invalid-type" }],
    [[{ ...westLake, displayName: "  " }], { field: "displayName", reason: "empty" }],
    [[{ ...westLake, displayName: "name\u0000" }], { field: "displayName", reason: "unsafe-text" }],
    [[{ ...westLake, displayName: "a".repeat(81) }], { field: "displayName", reason: "name-too-long" }],
    [[{ ...westLake, tilesetUrl: null }], { field: "tilesetUrl", reason: "invalid-path" }],
    [[{ ...westLake, tilesetUrl: "" }], { field: "tilesetUrl", reason: "invalid-path" }],
    [[{ ...westLake, tilesetUrl: `/${"a".repeat(500)}/tileset.json` }], { field: "tilesetUrl", reason: "invalid-path" }],
    [[{ ...westLake, tilesetUrl: "models/tileset.json" }], { field: "tilesetUrl", reason: "invalid-path" }],
    [[{ ...westLake, tilesetUrl: "https://example.test/tileset.json" }], { field: "tilesetUrl", reason: "invalid-path" }],
    [[{ ...westLake, tilesetUrl: "//models/tileset.json" }], { field: "tilesetUrl", reason: "invalid-path" }],
    [[{ ...westLake, tilesetUrl: "/models\\tileset.json" }], { field: "tilesetUrl", reason: "invalid-path" }],
    [[{ ...westLake, tilesetUrl: "/models//tileset.json" }], { field: "tilesetUrl", reason: "invalid-path" }],
    [[{ ...westLake, tilesetUrl: "/models/./tileset.json" }], { field: "tilesetUrl", reason: "invalid-path" }],
    [[{ ...westLake, tilesetUrl: "/models/model.json" }], { field: "tilesetUrl", reason: "invalid-path" }],
    [[{ ...westLake, tilesetUrl: "/models/ /tileset.json" }], { field: "tilesetUrl", reason: "invalid-path" }],
    [[{ ...westLake, tilesetUrl: "/models/../secret/tileset.json" }], { field: "tilesetUrl", reason: "invalid-path" }]
  ])("拒绝无效目录且只返回稳定错误", (input, details) => {
    expect(CityModelCatalog.create(input)).toEqual({ ok: false, error: { code: "INVALID_CATALOG", details } });
  });

  it("隔离恶意模型 getter 和异常文本", () => {
    const hostile = new Proxy({}, { get() { throw new Error("model-secret"); } });
    const result = CityModelCatalog.create([hostile]);

    expect(result).toEqual({ ok: false, error: { code: "INVALID_CATALOG", details: { field: "model", reason: "unreadable" } } });
    expect(JSON.stringify(result)).not.toContain("model-secret");
  });

  it("接受模型 ID 和显示名称的上界", () => {
    const result = CityModelCatalog.create([{ id: "a", displayName: "a".repeat(80), tilesetUrl: `/${"a".repeat(498)}/tileset.json` }, { id: "b".repeat(64), displayName: "模型", tilesetUrl: "/models/two/tileset.json" }]);
    expect(result).toMatchObject({ ok: true });
  });

  it("接受目录最大项数", () => {
    const input = Array.from({ length: 32 }, (_, index) => ({ id: `model-${index}`, displayName: "模型", tilesetUrl: `/models/${index}/tileset.json` }));
    expect(CityModelCatalog.create(input)).toMatchObject({ ok: true });
  });

  it("将不可读取的目录数组转换为稳定错误", () => {
    const input = new Proxy([westLake], { get() { throw new Error("array-secret"); } });
    const result = CityModelCatalog.create(input);
    expect(result).toEqual({ ok: false, error: { code: "INVALID_CATALOG", details: { field: "input", reason: "unreadable" } } });
    expect(JSON.stringify(result)).not.toContain("array-secret");
  });

  it("对非法或未知的模型 ID 返回可操作的稳定错误", () => {
    const created = CityModelCatalog.create([westLake]);
    if (!created.ok) throw created.error;

    expect(created.value.resolve(null)).toEqual({ ok: false, error: { code: "INVALID_MODEL_ID" } });
    expect(created.value.resolve("Bad")).toEqual({ ok: false, error: { code: "INVALID_MODEL_ID" } });
    expect(created.value.resolve("unknown-model")).toEqual({ ok: false, error: { code: "MODEL_NOT_FOUND" } });
  });
});
