import { describe, expect, it } from "vitest";
import { FfmpegLocator } from "../src/modules/media-pipeline/ffmpeg-locator/index.js";

const configured = { source: "configured" as const, executablePath: "C:/tools/custom-ffmpeg.exe" };
const bundled = { source: "bundled" as const, executablePath: "C:/app/resources/ffmpeg.exe" };
const system = { source: "system" as const, executablePath: "C:/Program Files/FFmpeg/bin/ffmpeg.exe" };

describe("媒体管线 ffmpeg-locator 契约", () => {
  it("按调用方给定优先级选择首个可执行候选，并保留来源和路径", () => {
    const checked: string[] = [];
    const locator = FfmpegLocator.create({ isExecutableFile: (path) => {
      checked.push(path);
      return path === bundled.executablePath || path === system.executablePath;
    } });

    const result = locator.locate([configured, bundled, system]);

    expect(result).toEqual({ ok: true, value: { executablePath: bundled.executablePath, source: "bundled" } });
    expect(checked).toEqual([configured.executablePath, bundled.executablePath]);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
  });

  it("全部候选不可执行时返回稳定且脱敏的缺失诊断", () => {
    const locator = FfmpegLocator.create({ isExecutableFile: () => false });
    const result = locator.locate([configured, bundled, system]);

    expect(result).toEqual({ ok: false, code: "FFMPEG_NOT_FOUND", diagnostic: "未找到可用的 FFmpeg。请安装 FFmpeg 或检查桌面端配置。" });
    expect(result.diagnostic).not.toContain("C:/");
  });

  it("拒绝畸形、空白、未知来源和重复路径，且不调用文件事实适配器", () => {
    let inspections = 0;
    const locator = FfmpegLocator.create({ isExecutableFile: () => { inspections += 1; return true; } });
    const invalidInputs: unknown[] = [
      null,
      {},
      [null],
      [configured, null],
      [{ source: "configured" }],
      [{ source: "configured", executablePath: "   " }],
      [{ source: "other", executablePath: configured.executablePath }],
      [configured, { source: "system", executablePath: configured.executablePath }]
    ];

    for (const input of invalidInputs) {
      expect(locator.locate(input)).toEqual({ ok: false, code: "INVALID_INPUT", diagnostic: "FFmpeg 候选配置无效。请检查桌面端安装配置。" });
    }
    expect(inspections).toBe(0);
  });

  it("将文件检查异常转为稳定的脱敏诊断，并停止后续检查", () => {
    const checked: string[] = [];
    const locator = FfmpegLocator.create({ isExecutableFile: (path) => {
      checked.push(path);
      throw new Error(`permission denied: ${path}`);
    } });
    const result = locator.locate([configured, bundled]);

    expect(result).toEqual({ ok: false, code: "INSPECTION_FAILED", diagnostic: "无法检查 FFmpeg 可执行文件。请检查桌面端权限与安装状态。" });
    expect(checked).toEqual([configured.executablePath]);
    expect(result.diagnostic).not.toContain(configured.executablePath);
  });

  it("不修改候选输入，也不会缓存此前检查结果", () => {
    const candidates = [configured, bundled];
    let available = false;
    const locator = FfmpegLocator.create({ isExecutableFile: (path) => available && path === bundled.executablePath });

    expect(locator.locate(candidates)).toMatchObject({ ok: false, code: "FFMPEG_NOT_FOUND" });
    available = true;
    expect(locator.locate(candidates)).toEqual({ ok: true, value: { executablePath: bundled.executablePath, source: "bundled" } });
    expect(candidates).toEqual([configured, bundled]);
  });

  it("在创建阶段拒绝不具备文件检查函数的装配依赖", () => {
    for (const facts of [{ isExecutableFile: 7 }, {}, null, undefined, 7]) {
      expect(() => FfmpegLocator.create(facts as never)).toThrow("Invalid file facts");
    }
  });
});
