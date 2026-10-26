import { describe, expect, it } from "vitest";
import { CapabilityGate } from "../src/modules/device-console/capability-gate/index.js";
import { StreamProtocolConfig } from "../src/modules/live-stream-control/stream-protocol-config/index.js";
import { StreamDispatcher, type StreamDispatchResult, type StreamDispatcherDependencies } from "../src/modules/live-stream-control/stream-dispatcher/index.js";

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture() {
  type Request = Parameters<StreamDispatcherDependencies["relay"]["sendCommand"]>[1];
  const commands: Array<ReturnType<typeof deferred> & { deviceId: string; request: Request }> = [];
  const dispatcher = StreamDispatcher.create({
    media: { snapshot: () => ({ phase: "running", endpoint: { host: "192.168.1.20", port: 1935 } }) },
    relay: {
      latestTelemetry: () => ({ payload: { sdkAvailability: "READY", airLink: "CONNECTED", camera: "CONNECTED" } }),
      sendCommand: (deviceId, request) => {
        const receipt = deferred();
        commands.push({ deviceId, request, ...receipt });
        return receipt.promise;
      },
    },
    capabilityGate: CapabilityGate,
    targetConfig: StreamProtocolConfig,
  });
  const command = (deviceId: string, index: number) => {
    const value = commands.filter((entry) => entry.deviceId === deviceId)[index];
    if (!value) throw new Error(`Missing command ${index} for ${deviceId}`);
    return value;
  };
  return { dispatcher, commands, command };
}

const interruptions = [
  { method: "recordDisconnected", code: "DISCONNECTED", phase: "disconnected" },
  { method: "recordSourceUnavailable", code: "SOURCE_UNAVAILABLE", phase: "failed" },
] as const;
const receipts = ["succeeded", "rejected", "exception"] as const;

function complete(command: ReturnType<typeof deferred>, receipt: typeof receipts[number]) {
  if (receipt === "exception") command.reject(new Error("Old transport failure"));
  else command.resolve({ status: receipt });
}

describe.each(interruptions)("StreamDispatcher $method recovery", ({ method, code, phase }) => {
  for (const oldOperation of ["start", "stop"] as const) {
    for (const newOperation of ["start", "stop"] as const) {
      it.each(receipts)(`ignores an old ${oldOperation} %s receipt while a new ${newOperation} is pending`, async (receipt) => {
        const { dispatcher, commands, command } = fixture();
        const old = dispatcher[oldOperation]("phone-1");
        const interrupted = dispatcher[method]("phone-1");
        expect(interrupted).toMatchObject({ phase, failureCode: code });
        const current = dispatcher[newOperation]("phone-1");
        const currentOutcomes: StreamDispatchResult[] = [];
        void current.then((outcome) => { currentOutcomes.push(outcome); });
        const before = dispatcher.get("phone-1");
        expect(before.phase).toBe(newOperation === "start" ? "starting" : "stopping");
        const published: unknown[] = [];
        dispatcher.subscribe((snapshots) => { published.push(snapshots); });

        complete(command("phone-1", 0), receipt);
        const oldOutcome = await old;

        expect.soft(dispatcher.get("phone-1")).toEqual(before);
        expect.soft(published).toEqual([]);
        expect.soft(oldOutcome).toEqual({ ok: false, operation: oldOperation, code, state: interrupted });
        expect.soft(currentOutcomes).toEqual([]);
        const conflictingOutcomes: StreamDispatchResult[] = [];
        void dispatcher.stop("phone-1").then((outcome) => { conflictingOutcomes.push(outcome); });
        await new Promise<void>((resolve) => { setImmediate(resolve); });
        expect.soft(conflictingOutcomes).toMatchObject([{ ok: false, code: "OPERATION_IN_PROGRESS" }]);
        expect.soft(commands).toHaveLength(2);

        command("phone-1", 1).resolve({ status: "succeeded" });
        await expect(current).resolves.toMatchObject({
          ok: true,
          operation: newOperation,
          state: { phase: newOperation === "start" ? "streaming" : "idle", failureCode: null },
        });
      });
    }
  }

  it.each(receipts)("does not let an old stop %s receipt consume the new stop's queued restarts", async (receipt) => {
    const { dispatcher, commands, command } = fixture();
    const oldStop = dispatcher.stop("phone-1");
    const cancelledRestart = dispatcher.start("phone-1");
    const interrupted = dispatcher[method]("phone-1");
    await expect(cancelledRestart).resolves.toEqual({ ok: false, operation: "start", code, state: interrupted });

    const currentStop = dispatcher.stop("phone-1");
    const restarts = [dispatcher.start("phone-1"), dispatcher.start("phone-1")];
    const restartOutcomes: StreamDispatchResult[] = [];
    for (const restart of restarts) void restart.then((outcome) => { restartOutcomes.push(outcome); });
    const before = dispatcher.get("phone-1");

    complete(command("phone-1", 0), receipt);
    const oldOutcome = await oldStop;

    expect.soft(oldOutcome).toEqual({ ok: false, operation: "stop", code, state: interrupted });
    expect.soft(dispatcher.get("phone-1")).toEqual(before);
    expect.soft(restartOutcomes).toEqual([]);
    expect.soft(commands.map((entry) => entry.request.name)).toEqual(["live-stream.stop", "live-stream.stop"]);

    command("phone-1", 1).resolve({ status: "succeeded" });
    await expect(currentStop).resolves.toMatchObject({ ok: true, operation: "stop", state: { phase: "idle" } });
    expect(dispatcher.get("phone-1").phase).toBe("starting");
    expect(commands.map((entry) => entry.request.name)).toEqual(["live-stream.stop", "live-stream.stop", "live-stream.start"]);
    expect(restartOutcomes).toEqual([]);

    command("phone-1", 2).resolve({ status: "succeeded" });
    const outcomes = await Promise.all(restarts);
    expect(outcomes[0]).toMatchObject({ ok: true, operation: "start", state: { phase: "streaming" } });
    expect(outcomes[1]).toBe(outcomes[0]);
  });
});

it("isolates recovery, busy state and queued restarts across four devices", async () => {
  const { dispatcher, commands, command } = fixture();
  const oldStart = dispatcher.start("phone-1");
  const oldStop = dispatcher.stop("phone-2");
  const unaffectedStart = dispatcher.start("phone-3");
  const unaffectedStop = dispatcher.stop("phone-4");
  const unaffectedRestart = dispatcher.start("phone-4");
  dispatcher.recordDisconnected("phone-1");
  dispatcher.recordSourceUnavailable("phone-2");
  const recoveredStart = dispatcher.start("phone-1");
  const recoveredStop = dispatcher.stop("phone-2");
  const recoveredRestart = dispatcher.start("phone-2");

  command("phone-4", 0).resolve({ status: "succeeded" });
  await expect(unaffectedStop).resolves.toMatchObject({ ok: true, operation: "stop" });
  command("phone-2", 0).resolve({ status: "succeeded" });
  command("phone-1", 0).resolve({ status: "succeeded" });
  command("phone-3", 0).resolve({ status: "succeeded" });
  const oldOutcomes = await Promise.all([oldStart, oldStop, unaffectedStart]);

  expect.soft(oldOutcomes[0]).toMatchObject({ ok: false, code: "DISCONNECTED" });
  expect.soft(oldOutcomes[1]).toMatchObject({ ok: false, code: "SOURCE_UNAVAILABLE" });
  expect.soft(oldOutcomes[2]).toMatchObject({ ok: true, state: { phase: "streaming" } });
  expect.soft(dispatcher.list().map(({ deviceId, phase }) => ({ deviceId, phase }))).toEqual([
    { deviceId: "phone-1", phase: "starting" },
    { deviceId: "phone-2", phase: "stopping" },
    { deviceId: "phone-3", phase: "streaming" },
    { deviceId: "phone-4", phase: "starting" },
  ]);
  expect.soft(commands.filter(({ deviceId }) => deviceId === "phone-2")).toHaveLength(2);
  expect.soft(commands.filter(({ deviceId }) => deviceId === "phone-4")).toHaveLength(2);

  command("phone-4", 1).resolve({ status: "succeeded" });
  command("phone-1", 1).resolve({ status: "succeeded" });
  command("phone-2", 1).resolve({ status: "succeeded" });
  await expect(unaffectedRestart).resolves.toMatchObject({ ok: true, operation: "start" });
  await expect(recoveredStart).resolves.toMatchObject({ ok: true, operation: "start" });
  await expect(recoveredStop).resolves.toMatchObject({ ok: true, operation: "stop" });
  command("phone-2", 2).resolve({ status: "succeeded" });
  await expect(recoveredRestart).resolves.toMatchObject({ ok: true, operation: "start" });
  expect(dispatcher.list().map(({ phase }) => phase)).toEqual(["streaming", "streaming", "streaming", "streaming"]);
});
