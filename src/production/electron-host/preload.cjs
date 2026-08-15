const { contextBridge, ipcRenderer } = require("electron");

const methods = Object.freeze([
  "state-snapshot", "network-hint",
  "route-import", "route-preview", "route-select", "route-remove",
  "assignment-assign", "assignment-clear",
  "mission-stage", "mission-upload", "mission-start", "mission-pause", "mission-resume", "mission-stop",
  "stream-start", "stream-stop", "stream-refresh", "stream-select", "stream-clear",
  "settings-transmission-read", "settings-transmission-write", "settings-camera-read", "settings-camera-write",
  "flight-request", "flight-confirm", "flight-cancel",
  "video-playback",
  "diagnostics-record",
]);

const relayHint = (process.argv.find((value) => value.startsWith("--relay-hint=")) ?? "--relay-hint=ws://<电脑IPv4>:8080/relay").slice("--relay-hint=".length);
const incidentLog = (process.argv.find((value) => value.startsWith("--incident-log=")) ?? "--incident-log=").slice("--incident-log=".length);

contextBridge.exposeInMainWorld("skyCommand", {
  relayHint,
  incidentLog,
  invoke: (name, input) => {
    if (!methods.includes(name)) return Promise.resolve({ ok: false, code: "METHOD_NOT_ALLOWED" });
    return ipcRenderer.invoke(name, input);
  },
  selectRouteFile: () => ipcRenderer.invoke("route-select-file"),
});
