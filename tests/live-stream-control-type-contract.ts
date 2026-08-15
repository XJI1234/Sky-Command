import { LiveStreamControl, type LiveStreamControlDependencies } from "../src/modules/live-stream-control/index.js";

declare const dependencies: LiveStreamControlDependencies;
const control = LiveStreamControl.create(dependencies);
void control.stop("phone-1");

// @ts-expect-error 一级组合根固定注入 RTMP 配置器，调用方不能传入内部依赖。
LiveStreamControl.create({ ...dependencies, targetConfig: { createRtmpTarget: () => ({}) } });
