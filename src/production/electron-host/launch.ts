import { mkdirSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { DesktopApplication } from "../desktop-application/index.js";
import { DesktopUiGateway } from "../desktop-ui-gateway/index.js";
import { DesktopShell } from "../desktop-shell/index.js";
import { NodeDiagnosticStore } from "../../adapters/node-diagnostic-store/index.js";
import { createMediaPorts } from "./media-ports.js";
import { IncidentJournal, mediaLogger, watchApplication, wrapGateway, wrapPhoneDiagnostics } from "./incident-journal.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = [here, join(here, ".."), join(here, "..", "..", "..")].find((dir) => existsSync(join(dir, "package.json"))) ?? join(here, "..");
const rendererFile = [join(projectRoot, "dist/renderer/index.html"), join(projectRoot, "src/production/operator-console/renderer/index.html")].find((path) => existsSync(path)) ?? join(projectRoot, "dist/renderer/index.html");
const rendererEntry = pathToFileURL(rendererFile).href;
const preloadPath = [join(projectRoot, "electron/preload.cjs"), join(projectRoot, "src/production/electron-host/preload.cjs")].find((path) => existsSync(path)) ?? join(projectRoot, "electron/preload.cjs");
const httpFlvRoot = join(projectRoot, "tmp-http-flv");
const logPath = join(projectRoot, "tmp", "desktop-launch.log");
const relayPort = 8_080;
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const log = (message: string): void => {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
  } catch { /* 启动日志失败不得挡住窗口 */ }
};

const privateIpv4 = (value: string): boolean => {
  const parts = value.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts as [number, number, number, number];
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
};

const virtualName = (name: string): boolean => /vmware|vmnet|vbox|virtualbox|vethernet|hyper-v|loopback|docker|wsl|tun|tailscale|mihomo|openvpn|nord|wireguard|hamachi|zerotier|radmin|\bvpn\b/i.test(name);
const wifiName = (name: string): boolean => /wi-?fi|wlan|wireless|无线/i.test(name);
const hotspotIpv4 = (ipv4: string): boolean =>
  ipv4.startsWith("172.20.10.") || ipv4.startsWith("192.168.42.") || ipv4.startsWith("192.168.43.") || ipv4.startsWith("192.168.137.");
const cardScore = (name: string, ipv4: string, kind: "wifi" | "physical"): number => {
  if (virtualName(name)) return 100;
  if (hotspotIpv4(ipv4)) return -10;
  if (kind === "wifi" || wifiName(name)) return 0;
  if (ipv4.startsWith("192.168.56.")) return 40;
  return 10;
};
const lanCards = (): readonly { readonly name: string; readonly enabled: true; readonly internal: false; readonly kind: "wifi" | "physical"; readonly ipv4: string }[] => {
  const cards: { readonly name: string; readonly enabled: true; readonly internal: false; readonly kind: "wifi" | "physical"; readonly ipv4: string; readonly score: number }[] = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      const ipv4 = address.family === "IPv4" || address.family === 4 ? address.address : null;
      if (ipv4 === null || address.internal || !privateIpv4(ipv4) || virtualName(name) || ipv4.startsWith("192.168.56.")) continue;
      const kind = wifiName(name) ? "wifi" as const : "physical" as const;
      cards.push({ name, enabled: true, internal: false, kind, ipv4, score: cardScore(name, ipv4, kind) });
    }
  }
  return cards
    .sort((left, right) => left.score - right.score || left.ipv4.localeCompare(right.ipv4))
    .map((card) => ({ name: card.name, enabled: true as const, internal: false as const, kind: card.kind, ipv4: card.ipv4 }));
};

async function launch(): Promise<void> {
  delete process.env.NODE_OPTIONS;
  log("launch begin");
  const journal = IncidentJournal.create();
  log(`incident ${journal.logPath}`);
  journal.record({ link: "phone-pc", level: "INFO", event: "DESKTOP_LAUNCH", detail: "Sky Command starting" });
  mkdirSync(httpFlvRoot, { recursive: true });
  const interfaces = lanCards();
  const preferred = interfaces[0];
  if (preferred === undefined) {
    journal.record({ link: "phone-pc", level: "ERROR", event: "LAN_UNAVAILABLE", detail: "No private IPv4 was found" });
    dialog.showErrorBox("Sky Command", "未检测到可用的局域网 IPv4。请连接 WLAN 后重开。");
    app.exit(1);
    return;
  }
  const mediaInterfaces = [preferred];
  const relayHint = `ws://${preferred.ipv4}:${relayPort}/relay`;
  let nextConfirmationId = 0;
  journal.record({ link: "phone-pc", level: "INFO", event: "RELAY_HINT", detail: `relay ${relayHint}` });
  app.setName("Sky Command");
  // WHIP/WHEP 旁路已封存：不装配 lowLatency，飞行页只走 RTMP→HTTP-FLV。
  const mediaPorts = createMediaPorts(mediaLogger(journal));
  let window: BrowserWindow | null = null;
  const created = DesktopApplication.create({
    network: { listenPort: 19_500, relayPort, manualHost: preferred.ipv4 },
    legacyMediaRequired: true,
    relay: {
      address: { host: "0.0.0.0", port: relayPort },
      handshakeTimeoutMs: 15_000,
      maxConnections: 8,
      commandTimeoutMs: 120_000,
      missionTimeoutMs: 600_000,
      diagnosticSink: wrapPhoneDiagnostics(NodeDiagnosticStore.create(), journal),
    },
    media: {
      dependencies: {
        rtmp: mediaPorts.rtmp,
        httpFlv: mediaPorts.httpFlv,
        player: { setSource: () => undefined, clear: () => undefined },
        clock: () => Date.now(),
      },
      options: { rtmpPort: 19_500, httpFlvPort: 18_080, health: { ingestTimeoutMs: 20_000, playbackTimeoutMs: 45_000 } },
      startInput: {
        interfaces: mediaInterfaces,
        manualHost: null,
        httpFlvRootDirectory: httpFlvRoot,
      },
    },
    mission: { createMissionId: (deviceId: string, routeId: string) => `mission-${deviceId}-${routeId}` },
    flight: { now: () => Date.now(), confirmation: { ttlMs: 15_000, createConfirmationId: () => `confirm-${++nextConfirmationId}` } },
    hardwareReadiness: { lanAddressAvailable: true, legacyMediaAvailable: true, sessionStableAfterMs: 15_000 },
    now: () => Date.now(),
  });
  if (!created.ok) throw new Error("桌面应用配置无效");
  const startedApp = await created.value.start();
  if (!startedApp.ok) {
    const detail = startedApp.code === "MEDIA_START_FAILED"
      ? "图传服务未能启动。请确认 19500（RTMP）与 18080（HTTP-FLV）未被占用。"
      : `桌面应用启动失败: ${startedApp.code}`;
    journal.record({ link: "uplink", level: "ERROR", event: "DESKTOP_START_FAILED", detail: startedApp.code });
    dialog.showErrorBox("Sky Command", detail);
    throw new Error(detail);
  }
  watchApplication(created.value, journal);
  const gateway = wrapGateway(DesktopUiGateway.create({
    application: created.value,
    relayHint: () => [`ws://${preferred.ipv4}:${relayPort}/relay`],
  }), journal);
  const shell = DesktopShell.create({
    applicationGateway: gateway,
    lifecycle: {
      acquire: () => true,
      release: () => { void created.value.dispose(); },
    },
    window: {
      create: (csp: string) => {
        window = new BrowserWindow({
          width: 1440,
          height: 900,
          title: "Sky Command",
          show: true,
          webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            additionalArguments: [`--relay-hint=${relayHint}`, `--incident-log=${journal.logPath}`],
          },
        });
        window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
          callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] } });
        });
        app.on("second-instance", () => {
          if (window === null) return;
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
        });
      },
      focus: () => { window?.show(); window?.focus(); },
      close: () => { window?.close(); window = null; },
    },
    renderer: {
      load: async (entry: string) => { if (window === null) throw new Error("window"); await window.loadURL(entry); },
      clearCache: async () => { await window?.webContents.session.clearCache(); },
    },
    paths: { userData: app.getPath("userData"), appRoot: projectRoot, rendererEntry, packaged: app.isPackaged },
  }, { csp: "default-src 'self' file: blob: http://127.0.0.1:* http://localhost:*; script-src 'self' file: blob: 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' file:; img-src 'self' data: blob: file: http://127.0.0.1:* http://localhost:* https://server.arcgisonline.com; connect-src 'self' blob: file: http://127.0.0.1:* http://localhost:* https://server.arcgisonline.com; media-src 'self' blob: http://127.0.0.1:* http://localhost:*; worker-src 'self' blob: file:; object-src 'none'" });

  for (const name of Object.keys(DesktopShell.methods)) {
    ipcMain.handle(name, (_event, input) => shell.invoke(name, input));
  }
  ipcMain.handle("route-select-file", async () => {
    if (window === null) return { ok: false };
    const selected = await dialog.showOpenDialog(window, {
      properties: ["openFile"],
      filters: [{ name: "Wayline route", extensions: ["kml", "kmz"] }],
    });
    const filePath = selected.filePaths[0];
    if (selected.canceled || filePath === undefined) return { ok: false };
    return { ok: true, fileName: basename(filePath), bytes: new Uint8Array(readFileSync(filePath)) };
  });
  const started = await shell.start();
  if (!started.ok) throw new Error(started.code);
  log("window ready");
  app.on("window-all-closed", () => { void shell.dispose(); app.quit(); });
}

if (!app.requestSingleInstanceLock()) {
  log("second instance exit");
  app.quit();
} else {
  app.whenReady().then(() => launch()).catch((error: unknown) => {
    log(error instanceof Error ? error.stack ?? error.message : String(error));
    console.error(error);
    app.exit(1);
  });
}
