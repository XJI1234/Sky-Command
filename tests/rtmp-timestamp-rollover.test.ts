import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
import "../src/production/electron-host/media-ports.js";

const require = createRequire(import.meta.url);
const NodeRtmpSession = require("node-media-server/src/node_rtmp_session.js");
const context = require("node-media-server/src/node_core_ctx.js");

it.each([undefined, { app: "live" }])("cleans RTMP sessions before or after the connect command: %j", (metadata) => {
  const socket = Object.assign(new EventEmitter(), {
    remoteAddress: "127.0.0.1", bytesRead: 0, bytesWritten: 0, destroy: vi.fn(),
  });
  const session = new NodeRtmpSession({ rtmp: { chunk_size: 128, gop_cache: true } }, socket);
  session.isStarting = true;
  session.connectCmdObj = metadata;
  try {
    expect(() => session.stop()).not.toThrow();
    expect(context.sessions.has(session.id)).toBe(false);
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(session.connectCmdObj).toMatchObject({ bytesRead: 0, bytesWritten: 0, ...(metadata ?? {}) });
  } finally { context.sessions.delete(session.id); }
});

function parserFixture() {
  const socket = Object.assign(new EventEmitter(), { remoteAddress: "127.0.0.1" });
  const session = new NodeRtmpSession({ rtmp: { chunk_size: 128, gop_cache: true } }, socket);
  const delivered: { cid: number; time: number; payload: Buffer }[] = [];
  session.rtmpHandler = () => {
    const packet = session.parserPacket;
    delivered.push({ cid: packet.header.cid, time: packet.clock, payload: Buffer.from(packet.payload.subarray(0, packet.header.length)) });
  };
  const payload = Buffer.alloc(300, 0x27);
  const feed = (fmt: number, timestamp: number, cid = 4, fragmented = false) => {
    const wire = session.rtmpChunksCreate({ header: { fmt, cid, timestamp, length: payload.length, type: 9, stream_id: 1 }, payload });
    if (fragmented) {
      for (const byte of wire) session.rtmpChunkRead(Buffer.from([byte]), 0, 1);
    } else session.rtmpChunkRead(wire, 0, wire.length);
  };
  return { session, delivered, payload, feed, dispose: () => context.sessions.delete(session.id) };
}

it("keeps dispatching video after an unsigned negative delta wraps the RTMP clock", () => {
  const fixture = parserFixture();
  try {
    fixture.feed(0, 0);
    fixture.feed(1, 45);
    fixture.feed(1, 0xfffffffb); // -5 ms encoded as an unsigned delta, observed from DJI.
    fixture.feed(1, 45);
    fixture.feed(1, 0xfffffffd);
    fixture.feed(1, 45);
    expect(fixture.delivered.map(packet => packet.time)).toEqual([0, 45, 40, 85, 82, 127]);
    expect(fixture.delivered.every(packet => packet.payload.equals(fixture.payload))).toBe(true);
  } finally { fixture.dispose(); }
});

it("emits a continuous FLV timeline when an initial backwards timestamp crosses zero", () => {
  const fixture = parserFixture();
  const session = fixture.session;
  session.videoFps = 24;
  session.videoCodec = 7;
  session.rtmpHandler = () => session.rtmpVideoHandler();
  const emit = (fmt: number, timestamp: number) => {
    const payload = Buffer.from([0x27, 1, 0, 0, 0, 0, 0, 0, 2, 0x41, 0]);
    const wire = session.rtmpChunksCreate({ header: { fmt, cid: 4, timestamp, length: payload.length, type: 9, stream_id: 1 }, payload });
    for (const byte of wire) session.rtmpChunkRead(Buffer.from([byte]), 0, 1);
  };
  try {
    emit(0, 0);
    emit(1, 0xffffffff);
    emit(1, 45);
    emit(1, 45);
    emit(1, 0xfffffffb);
    emit(1, 45);
    const times = [...session.flvGopCacheQueue].map((tag: Buffer) => tag.readUIntBE(4, 3) + tag[7]! * 0x1000000);
    expect(times).toEqual([0, 0, 44, 89, 89, 129]);
    expect(session.parserPacket.clock).toBe(129);
  } finally { fixture.dispose(); }
});

it("rebases a publisher's absolute clock and handles normal uint32 rollover in FLV", () => {
  const fixture = parserFixture();
  const session = fixture.session;
  session.videoFps = 24;
  session.videoCodec = 7;
  session.rtmpHandler = () => session.rtmpVideoHandler();
  try {
    fixture.feed(0, 0xfffffff0);
    fixture.feed(1, 32);
    fixture.feed(1, 45);
    const times = [...session.flvGopCacheQueue].map((tag: Buffer) => tag.readUIntBE(4, 3) + tag[7]! * 0x1000000);
    expect(times).toEqual([0, 32, 77]);
    expect(session.parserPacket.clock).toBe(61);
  } finally { fixture.dispose(); }
});

it("handles clock rollover and extended timestamps across fragmented TCP chunks", () => {
  const fixture = parserFixture();
  try {
    fixture.feed(0, 0xfffffff0, 4, true);
    fixture.feed(1, 32, 4, true);
    fixture.feed(1, 45, 4, true);
    expect(fixture.delivered.map(packet => packet.time)).toEqual([0xfffffff0, 16, 61]);
    expect(fixture.delivered.every(packet => packet.payload.equals(fixture.payload))).toBe(true);
  } finally { fixture.dispose(); }
});

it("normalizes each chunk stream independently and preserves an absolute timestamp reset", () => {
  const fixture = parserFixture();
  try {
    fixture.feed(0, 45, 4);
    fixture.feed(0, 1000, 5);
    fixture.feed(1, 0xfffffffb, 4);
    fixture.feed(1, 45, 5);
    fixture.feed(0, 0, 4);
    fixture.feed(1, 45, 4);
    expect(fixture.delivered.map(({ cid, time }) => [cid, time])).toEqual([[4, 45], [5, 1000], [4, 40], [5, 1045], [4, 0], [4, 45]]);
  } finally { fixture.dispose(); }
});
