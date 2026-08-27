import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/modules/cross-runtime-e2e/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      include: [
        "src/modules/desktop-settings/index.ts",
        "src/modules/route-library/index.ts",
        "src/modules/route-library/domain/**/*.ts",
        "src/modules/route-library/importer/**/*.ts",
        "src/modules/route-library/qualification/**/*.ts",
        "src/modules/route-library/catalog/**/*.ts",
        "src/modules/route-library/preview/**/*.ts",
        "src/modules/route-library/route-workspace/**/*.ts",
        "src/modules/desktop-settings/network-settings/**/*.ts",
        "src/modules/desktop-settings/map-settings/**/*.ts",
        "src/modules/desktop-settings/settings-store/**/*.ts",
        "src/modules/relay-link/protocol-core/**/*.ts",
        "src/modules/relay-link/relay-server/**/*.ts",
        "src/modules/relay-link/device-registry/**/*.ts",
        "src/modules/relay-link/command-tracker/**/*.ts",
        "src/modules/relay-link/telemetry-intake/**/*.ts",
        "src/modules/relay-link/mission-phase-intake/**/*.ts",
        "src/modules/relay-link/mission-sender/**/*.ts",
        "src/modules/relay-link/index.ts",
        "src/modules/mission-control/mission-phase-domain/**/*.ts",
        "src/modules/mission-control/preflight-check/**/*.ts",
        "src/modules/mission-control/mission-dispatcher/**/*.ts",
        "src/modules/mission-control/relay-device-snapshot/**/*.ts",
        "src/modules/mission-control/relay-mission-phase-snapshot/**/*.ts",
        "src/modules/mission-control/index.ts",
        "src/modules/geo-map/map-engine-adapter/**/*.ts",
        "src/modules/geo-map/basemap-provider/**/*.ts",
        "src/modules/geo-map/city-model/**/*.ts",
        "src/modules/geo-map/index.ts",
        "src/modules/route-planning/planning-domain/**/*.ts",
        "src/modules/route-planning/building-footprint-planner/**/*.ts",
        "src/modules/route-planning/obstacle-analysis/**/*.ts",
        "src/modules/route-planning/plan-workspace/**/*.ts",
        "src/modules/route-planning/index.ts",
        "src/modules/device-console/link-chain/**/*.ts",
        "src/modules/device-console/capability-gate/**/*.ts",
        "src/modules/device-console/pairing-controller/**/*.ts",
        "src/modules/device-console/device-guidance/**/*.ts",
        "src/modules/device-console/device-settings-panel/**/*.ts",
        "src/modules/device-console/index.ts",
        "src/adapters/node-websocket-relay/index.ts",
        "src/adapters/relay-device-settings/index.ts",
        "src/modules/app-shell/index.ts",
        "src/modules/app-shell/process-lifecycle/**/*.ts",
        "src/modules/app-shell/window-manager/**/*.ts",
        "src/modules/app-shell/renderer-host/**/*.ts",
        "src/modules/app-shell/runtime-paths/**/*.ts",
        "src/modules/app-shell/ipc-bridge/**/*.ts",
        "src/modules/media-pipeline/stream-health/**/*.ts",
        "src/modules/media-pipeline/network-endpoint/**/*.ts",
        "src/modules/media-pipeline/ffmpeg-locator/**/*.ts",
        "src/modules/media-pipeline/transcode-runner/**/*.ts",
        "src/modules/media-pipeline/http-flv-server/**/*.ts",
        "src/modules/media-pipeline/rtmp-ingest/**/*.ts",
        "src/modules/media-pipeline/video-player/**/*.ts",
        "src/modules/media-pipeline/index.ts",
        "src/modules/flight-control/dangerous-action-confirm/**/*.ts",
        "src/modules/flight-control/flight-command-dispatcher/**/*.ts",
        "src/modules/flight-control/index.ts"
        ,"src/modules/live-stream-control/stream-protocol-config/**/*.ts"
        ,"src/modules/live-stream-control/stream-dispatcher/**/*.ts"
        ,"src/modules/live-stream-control/index.ts"
        ,"src/production/desktop-runtime/**/*.ts"
        ,"src/production/node-runtime/**/*.ts"
        ,"src/production/relay-operations-adapter/**/*.ts"
        ,"src/production/operation-workflow/**/*.ts"
        ,"src/production/operator-console/device-fact-summary/**/*.ts"
        ,"src/production/desktop-application/**/*.ts"
        ,"src/production/desktop-ui-gateway/**/*.ts"
      ],
      exclude: [
        "src/modules/route-library/domain/index.ts",
        "src/modules/route-library/importer/internal/types.ts",
        "src/modules/route-library/qualification/internal/types.ts",
        "src/modules/route-library/catalog/CONTRACT.md"
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100
      }
    }
  }
});
