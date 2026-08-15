import { StreamProtocolConfig, type RtmpTargetInput, type StreamTargetResult } from "../src/modules/live-stream-control/stream-protocol-config/index.js";

declare const input: RtmpTargetInput;
const result: StreamTargetResult = StreamProtocolConfig.createRtmpTarget(input);
void result;

// @ts-expect-error 成功目标协议固定为 RTMP。
const invalidResult: StreamTargetResult = { ok: true, value: { protocol: "rtsp", rtmpUrl: "rtsp://computer/live/device" } };
void invalidResult;
