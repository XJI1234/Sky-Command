import { createSkyCommandOperations } from '@xjicloud/sky-command-sdk/operations';
import { RouteLibrary } from '@xjicloud/sky-command-sdk/routes';
import { MissionControl, PreflightCheck } from '@xjicloud/sky-command-sdk/mission';
import { FlightControl, FlightCommandDispatcher } from '@xjicloud/sky-command-sdk/flight';
import { RelayDeviceSettings, DeviceSettingsPanel } from '@xjicloud/sky-command-sdk/device';

// The caller supplies one already-created client; this function never connects implicitly.
/** @param {import('@xjicloud/sky-command-sdk').SkyCommandClient} client */
export function createBusiness(client) {
  const operations = createSkyCommandOperations(client);
  const created = RouteLibrary.create();
  if (!created.ok) throw new Error(created.error.code);
  const routes = created.value;
  const missions = MissionControl.create({
    routeSource: routes,
    relay: { ...operations.missionGateway(), subscribe: operations.subscribe }
  }, { createMissionId: () => crypto.randomUUID() });
  const flights = FlightControl.create({
    dispatcher: FlightCommandDispatcher.create({ relay: operations.flightGateway(), preflight: {
      evaluateFlightAction: input => PreflightCheck.evaluateFlightAction(/** @type {import('@xjicloud/sky-command-sdk/mission').FlightActionPreflightInput} */ (input))
    } })
  }, { now: Date.now, confirmation: { ttlMs: 15000, createConfirmationId: () => crypto.randomUUID() } });
  const settings = DeviceSettingsPanel.create({ port: RelayDeviceSettings.create({ relay: client }) });
  return {
    operations, routes, missions, flights, settings,
    dispose() { flights.dispose(); missions.dispose(); operations.dispose(); routes.clear(); }
  };
}
// Import original KMZ bytes via routes.importFile; stage then upload/start via missions.
// flights.request produces a confirmation. Show it to the user before flights.confirm.
