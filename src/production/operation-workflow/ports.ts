import type { DeviceSettingsPanelInstance } from "../../modules/device-console/index.js";
import type { FlightControlInstance } from "../../modules/flight-control/index.js";
import type { LiveStreamControlInstance } from "../../modules/live-stream-control/index.js";
import type { MediaPipelineInstance } from "../../modules/media-pipeline/index.js";
import type { MissionControlInstance } from "../../modules/mission-control/index.js";
import type { RouteLibraryInstance } from "../../modules/route-library/index.js";
import type { RelayOperationsAdapterInstance } from "../relay-operations-adapter/index.js";

/** Supplies display telemetry plus short-lived, session-bound control telemetry for workflow decisions. */
export type RelayOperationsPort = Pick<RelayOperationsAdapterInstance, "devices" | "telemetry" | "controlTelemetry" | "refreshTelemetry" | "subscribe">;

/** Owns route import, lookup, selection, and removal; the workflow does not access route storage directly. */
export type RouteLibraryPort = Pick<RouteLibraryInstance, "importFile" | "list" | "getPreview" | "select" | "remove">;

/** Owns the device-side DJI waypoint mission lifecycle. */
export type MissionControlPort = Pick<MissionControlInstance, "stage" | "upload" | "start" | "pause" | "resume" | "stop" | "get" | "forget" | "subscribe">;

/** Owns the production RTMP start/stop lane and its observable state. */
export type LiveStreamControlPort = Pick<LiveStreamControlInstance, "start" | "stop" | "get" | "recordDisconnected" | "subscribe">;

/** Owns desktop RTMP ingest, HTTP-FLV playback state, and player selection. */
export type MediaPipelinePort = Pick<MediaPipelineInstance, "snapshot" | "evaluate" | "notifyPlaybackReady" | "selectPlayer" | "clearPlayer">;

/** Owns local confirmation state and dispatch of dangerous flight commands. */
export type FlightControlPort = Pick<FlightControlInstance, "request" | "confirm" | "cancel" | "get" | "clear" | "subscribe">;

/** Owns cached camera and transmission settings and delegates their device requests. */
export type DeviceSettingsPort = Pick<DeviceSettingsPanelInstance, "snapshot" | "readTransmission" | "writeTransmission" | "readCamera" | "writeCamera">;

/** Supplies the desktop facts needed by the hardware-readiness evaluator. */
export interface HardwareReadinessPort {
  readonly lanAddressAvailable: boolean;
  readonly legacyMediaAvailable: boolean;
}

export interface OperationWorkflowDependencies {
  readonly relayOperations: RelayOperationsPort;
  readonly routeLibrary: RouteLibraryPort;
  readonly missionControl: MissionControlPort;
  readonly liveStreamControl: LiveStreamControlPort;
  readonly mediaPipeline: MediaPipelinePort;
  readonly flightControl: FlightControlPort;
  readonly deviceSettings: DeviceSettingsPort;
  readonly hardwareReadiness: HardwareReadinessPort;
  readonly now: () => number;
}

export type WorkflowSubscriptionPort = Pick<RelayOperationsPort, "subscribe">
  | Pick<MissionControlPort, "subscribe">
  | Pick<LiveStreamControlPort, "subscribe">
  | Pick<FlightControlPort, "subscribe">;
