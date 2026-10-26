import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const main = readFileSync(new URL("../src/production/operator-console/renderer/main.ts", import.meta.url), "utf8");
const extract = (start: string, end: string): string => main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start)));

function harness(pendingMethod: string) {
  let release!: (value: unknown) => void;
  const pending = new Promise<unknown>((resolve) => { release = resolve; });
  let waypoint = 1;
  const invoke = vi.fn((method: string) => method === pendingMethod ? pending : Promise.resolve({ ok: true, value: method === "state-snapshot" ? { waypoint } : {} }));
  const source = [
    'let lastSnapshot = {}; let lastRelayHint = ""; let lastRoutePreview = null;',
    'const state = { workspace: "routes" };',
    extract("const renderAbortError = ", "const safeRenderInvoke = "),
    extract("async function projectView(", "const projectCached = "),
    extract("const settledInvoke = ", "function applyRouteMap("),
    'globalThis.api = { fetchOnce, projectView, snapshot: () => lastSnapshot };',
  ].join("\n");
  const context = {
    bridge: () => ({ invoke }), console,
    projectCached: () => ({ missionDeviceId: "A", streamDeviceId: "B", selectedRoute: { routeId: "r1" } }),
    read: (value: Record<string, unknown> | null, key: string) => value?.[key],
    previewGeometry: () => null,
    paintScheduler: { request: async () => undefined },
    api: undefined as unknown as { fetchOnce: (signal: AbortSignal) => Promise<void>; projectView: () => Promise<unknown>; snapshot: () => unknown },
  };
  runInNewContext(transformSync(source, { loader: "ts", target: "es2022" }).code, context);
  return { api: context.api, invoke, release, advance: () => { waypoint += 1; } };
}

describe("renderer status refresh isolation", () => {
  it("retains each device feedback and rejects older connection results", () => {
    class Element { textContent = ""; dataset: Record<string, string> = {}; }
    const node = new Element();
    const context = {
      HTMLElement: Element, document: { querySelector: () => node }, feedbackByAction: new Map(),
      api: undefined as unknown as {
        feedbackForDevice: (action: string, deviceId: string, epoch: number, feedback: object) => void;
        renderOperationFeedback: (action: string, deviceId: string, epoch: number) => void;
      },
    };
    const source = extract("const feedbackForDevice = ", "const flightActionLabel = ");
    runInNewContext(transformSync(`${source}\nglobalThis.api = { feedbackForDevice, renderOperationFeedback };`, { loader: "ts" }).code, context);
    for (const deviceId of ["A", "B", "C", "D"]) {
      context.api.feedbackForDevice("mission-start", deviceId, 2, { message: deviceId, source: "msdk", outcome: "accepted" });
    }
    for (const deviceId of ["A", "B", "C", "D"]) {
      context.api.renderOperationFeedback("mission-start", deviceId, 2);
      expect(node.textContent).toBe(deviceId);
    }
    context.api.feedbackForDevice("mission-start", "A", 1, { message: "stale" });
    context.api.renderOperationFeedback("mission-start", "A", 2);
    expect(node.textContent).toBe("A");
    context.api.renderOperationFeedback("mission-start", "A", 3);
    expect(node.textContent).toBe("");
  });

  it.each(["stream-refresh", "network-hint", "route-preview"])("updates snapshots without waiting for %s", async (method) => {
    const fixture = harness(method);
    let completed = false;
    void fixture.api.fetchOnce(new AbortController().signal).then(() => { completed = true; });
    await vi.waitFor(() => expect(completed).toBe(true), { timeout: 100 });
    expect(fixture.api.snapshot()).toEqual({ waypoint: 1 });
    fixture.advance();
    await fixture.api.fetchOnce(new AbortController().signal);
    expect(fixture.api.snapshot()).toEqual({ waypoint: 2 });
    expect(fixture.invoke.mock.calls.filter(([name]) => name === method)).toHaveLength(1);
    fixture.release(undefined);
  });

  it("does not delay a command view for a pending network hint", async () => {
    const fixture = harness("network-hint");
    let completed = false;
    void fixture.api.projectView().then(() => { completed = true; });
    await vi.waitFor(() => expect(completed).toBe(true), { timeout: 100 });
    fixture.release(undefined);
  });

  it("ignores a cancelled snapshot even if the bridge later returns it", async () => {
    const fixture = harness("state-snapshot");
    const controller = new AbortController();
    const refresh = fixture.api.fetchOnce(controller.signal);
    controller.abort();
    await refresh;
    fixture.release({ ok: true, value: { waypoint: 99 } });
    await Promise.resolve();
    expect(fixture.api.snapshot()).toEqual({});
  });
});
