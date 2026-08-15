import { describe, expect, it } from "vitest";
import { buildReportFromRecordedTests } from "../src/modules/cross-runtime-e2e/vitest-reporter.js";

describe("跨运行时 Vitest 报告器", () => {
  it("只有完整通过的场景目录才能覆盖全部模块和矩阵", () => {
    const names = [
      "桌面设置和无 Electron 外壳通过正式公开接口完成生命周期",
      "运行时生成的合格 KMZ 经正式航线库和任务控制上传到手机",
      "手机诊断事件经正式网关到达桌面并收到确认",
      "桌面设备设置面板通过正式适配器读取手机相机设置",
      "两台中继并行工作时一个故障不会污染另一台",
      "手机断线重连更换会话并隔离旧会话迟到结果",
      "非法 WebSocket 帧被隔离且不影响合法手机会话",
      "握手前断开和握手超时均被回收且不影响合法会话",
      "固定种子动作序列隔离非法输入并保持正式会话可恢复",
      "DJI 拒绝相机设置写入时桌面收到失败且原设置不被污染",
      "航线上传等待 DJI 回调超时时不会把已暂存航线误报为已上传",
      "航线上传隔离拒绝抛出重复和迟到 DJI 回调",
      "航线控制隔离拒绝抛出超时重复和迟到 DJI 回调",
      "设置接缝隔离抛出超时重复和迟到 DJI 回调",
      "图传接缝隔离拒绝抛出重复和迟到 DJI 回调",
      "图传启动超时时桌面收到失败而不是媒体已就绪",
      "正式媒体流水线为图传控制生成目标并驱动手机开始停止",
      "DJI 同步拒绝起飞时不会阻塞后续飞控命令",
      "DJI 抛出重复和迟到回调均被隔离且不会污染后续命令",
      "桌面正式飞控必须显式确认后才经手机执行",
      "通过真实 WebSocket 发现 Kotlin 中继并读取正式遥测",
      "DJI 无回调会有限超时且关闭操作幂等",
      "桌面关闭会解除在途命令而不留下挂起 Promise",
      "手机进程先退出会移除设备并解除在途命令",
      "全部正式中继命令跨真实 WebSocket 覆盖输入等价类与边界",
      "穷尽编解码所有已声明的有效帧类型",
      "拒绝重复字段缺失字段和错误字段类型并忽略兼容额外字段",
      "拒绝无效 UTF-8 和无效 JSON 且诊断不泄露原始载荷",
      "两端生产源码的公开有限集合必须与审阅基线完全一致",
      "逐项比较航线生产状态机的全部状态与事件组合",
      "相同种子产生相同动作序列且不同种子发生分歧",
      "失败序列缩减器得到仍可复现失败的一项最小序列",
      "拒绝旧任务修订和旧设备代次但允许新任务从序号一重新开始",
      "同一任务拒绝重复和倒退序号",
      "成功关闭会回收子进程定时器和 WebSocket，且同一套件可连续运行两次",
      "工作流模型和验收证据门禁的全部变异均被杀死",
    ];
    const report = buildReportFromRecordedTests(names.map((name) => ({ name, state: "passed" as const })));

    expect(report.requirements.filter((entry) => entry.status === "not-covered").map((entry) => entry.requirement)).toEqual([]);
    expect(report.matrices.filter((entry) => entry.status === "not-covered").map((entry) => entry.matrix)).toEqual([]);
    expect(report.modules.filter((entry) => entry.status === "not-covered").map((entry) => `${entry.runtime}:${entry.module}`)).toEqual([]);
    expect(report.modules).toContainEqual({
      module: "operation-workflow",
      runtime: "desktop",
      status: "covered",
    });
    expect(report.invalidEvidence).toEqual([]);
    expect(report.overallStatus).toBe("passed");
    expect(report.modules.every((entry) => entry.status !== "not-covered" && entry.status !== "failed")).toBe(true);
    expect(report.matrices.every((entry) => entry.status === "covered")).toBe(true);
  });

  it("缺少或失败的目录场景不能生成通过报告", () => {
    expect(buildReportFromRecordedTests([]).overallStatus).toBe("incomplete");
    expect(buildReportFromRecordedTests([{ name: "图传启动超时时桌面收到失败而不是媒体已就绪", state: "failed" }]).overallStatus).toBe("failed");
  });
});
