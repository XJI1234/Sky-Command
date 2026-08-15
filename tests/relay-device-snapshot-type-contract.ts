import { expectTypeOf } from "vitest";
import { RelayDeviceSnapshotReader } from "../src/modules/mission-control/relay-device-snapshot/index.js";

expectTypeOf(RelayDeviceSnapshotReader.read).returns.toEqualTypeOf<ReadonlySet<string> | null>();
expectTypeOf(RelayDeviceSnapshotReader.read({ devices: [] })).toEqualTypeOf<ReadonlySet<string> | null>();
