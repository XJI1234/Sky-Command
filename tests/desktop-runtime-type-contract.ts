import { DesktopRuntime, type DesktopRuntimeDependencies } from "../src/production/desktop-runtime/index.js";

declare const dependencies: DesktopRuntimeDependencies;
const runtime = DesktopRuntime.create(dependencies, { mediaStartInput: {} });
void runtime.start();
void runtime.dispose();

// @ts-expect-error 生产装配必须同时获得中继、媒体和直播控制三个公开模块。
DesktopRuntime.create({ relay: dependencies.relay, media: dependencies.media }, { mediaStartInput: {} });
