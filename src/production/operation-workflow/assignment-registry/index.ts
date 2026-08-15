export interface Assignment { readonly deviceId: string; readonly routeId: string; }

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);

function create() {
  const values = new Map<string, string>();
  return freeze({
    assign: (deviceId: string, routeId: string): boolean => {
      if (!validId(deviceId) || !validId(routeId)) return false;
      values.set(deviceId, routeId);
      return true;
    },
    get: (deviceId: string): string | null => validId(deviceId) ? values.get(deviceId) ?? null : null,
    clear: (deviceId: string): boolean => validId(deviceId) && values.delete(deviceId),
    removeDevice: (deviceId: string): boolean => validId(deviceId) && values.delete(deviceId),
    routesInUse: (routeId: string): readonly string[] => !validId(routeId) ? freeze([]) : freeze([...values].filter(([, assigned]) => assigned === routeId).map(([deviceId]) => deviceId).sort()),
    snapshot: (): readonly Assignment[] => freeze([...values].map(([deviceId, routeId]) => freeze({ deviceId, routeId })).sort((left, right) => left.deviceId.localeCompare(right.deviceId)))
  });
}

export const AssignmentRegistry = freeze({ create });
