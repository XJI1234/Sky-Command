const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);

export const ARMABLE_ACTIONS = Object.freeze(["flight-takeoff", "flight-land", "flight-return-home", "mission-start"] as const);
export type ArmableAction = (typeof ARMABLE_ACTIONS)[number];

export const SAME_CLICK_FLIGHT_CONFIRM = Object.freeze([
  "flight-confirm-landing",
  "flight-stop-takeoff",
  "flight-stop-auto-landing",
] as const);

export const ARM_SETTLE_MS = 300;
export const ARM_HOLD_MS = 5_000;

export const IDLE_LABELS: Readonly<Record<ArmableAction, string>> = Object.freeze({
  "flight-takeoff": "起飞",
  "flight-land": "降落",
  "flight-return-home": "返航",
  "mission-start": "执行航线",
});

export const ARMED_LABELS: Readonly<Record<ArmableAction, string>> = Object.freeze({
  "flight-takeoff": "确认起飞",
  "flight-land": "确认降落",
  "flight-return-home": "确认返航",
  "mission-start": "确认执行航线",
});

export type PendingFlightConfirmation = Readonly<{
  readonly deviceId: string;
  readonly action: string;
  readonly confirmationId: string;
  readonly expiresAtMs: number;
}>;

export type ConfirmDispatch =
  | Readonly<{ readonly kind: "dispatch"; readonly confirmation: PendingFlightConfirmation }>
  | Readonly<{ readonly kind: "wait" }>;

export type ArmedCommand = Readonly<{ readonly action: ArmableAction; readonly armedAtMs: number }>;

export type ArmClickResult =
  | Readonly<{ readonly kind: "arm"; readonly next: ArmedCommand }>
  | Readonly<{ readonly kind: "confirm"; readonly next: null }>
  | Readonly<{ readonly kind: "ignore"; readonly next: ArmedCommand }>
  | Readonly<{ readonly kind: "disarm"; readonly next: null }>;

export const isArmableAction = (action: string): action is ArmableAction =>
  (ARMABLE_ACTIONS as readonly string[]).includes(action);

export const isSameClickFlightConfirm = (action: string): boolean =>
  (SAME_CLICK_FLIGHT_CONFIRM as readonly string[]).includes(action);

export function interpretArmClick(armed: ArmedCommand | null, action: string, nowMs: number): ArmClickResult {
  if (!isArmableAction(action)) return freeze({ kind: "disarm", next: null });
  if (armed === null || armed.action !== action || nowMs - armed.armedAtMs >= ARM_HOLD_MS) {
    return freeze({ kind: "arm", next: freeze({ action, armedAtMs: nowMs }) });
  }
  if (nowMs - armed.armedAtMs < ARM_SETTLE_MS) return freeze({ kind: "ignore", next: armed });
  return freeze({ kind: "confirm", next: null });
}

export function expireArm(armed: ArmedCommand | null, nowMs: number): ArmedCommand | null {
  if (armed === null) return null;
  return nowMs - armed.armedAtMs >= ARM_HOLD_MS ? null : armed;
}

export function buttonLabel(action: ArmableAction, armed: ArmedCommand | null): string {
  return armed !== null && armed.action === action ? ARMED_LABELS[action] : IDLE_LABELS[action];
}

export const flightWorkflowAction = (uiAction: string): string =>
  uiAction.startsWith("flight-") ? uiAction.slice("flight-".length) : uiAction;

const liveConfirmation = (pending: PendingFlightConfirmation | null, nowMs: number): PendingFlightConfirmation | null =>
  pending !== null && pending.expiresAtMs > nowMs ? pending : null;

export function confirmationMatchesClick(
  pending: PendingFlightConfirmation | null,
  requested: Readonly<{ readonly deviceId: string | null; readonly uiAction: string; readonly nowMs: number }>,
): pending is PendingFlightConfirmation {
  const live = liveConfirmation(pending, requested.nowMs);
  return live !== null
    && requested.deviceId !== null
    && live.deviceId === requested.deviceId
    && live.action === flightWorkflowAction(requested.uiAction);
}

export function confirmationCreatedByRequest(
  pending: PendingFlightConfirmation | null,
  previousConfirmationId: string | null,
  requested: Readonly<{ readonly deviceId: string | null; readonly uiAction: string; readonly nowMs: number }>,
): boolean {
  return confirmationMatchesClick(pending, requested) && pending.confirmationId !== previousConfirmationId;
}

export function flightConfirmDispatch(
  pending: PendingFlightConfirmation | null,
  requested: Readonly<{ readonly deviceId: string | null; readonly uiAction: string; readonly nowMs: number }>,
): ConfirmDispatch {
  return confirmationMatchesClick(pending, requested) ? freeze({ kind: "dispatch", confirmation: pending }) : freeze({ kind: "wait" });
}

export function sameClickConfirmDispatch(
  pending: PendingFlightConfirmation | null,
  previousConfirmationId: string | null,
  requested: Readonly<{ readonly deviceId: string | null; readonly uiAction: string; readonly nowMs: number }>,
): ConfirmDispatch {
  return confirmationCreatedByRequest(pending, previousConfirmationId, requested)
    ? freeze({ kind: "dispatch", confirmation: pending as PendingFlightConfirmation })
    : freeze({ kind: "wait" });
}

export function adoptPendingConfirmation(
  local: PendingFlightConfirmation | null,
  snapshot: PendingFlightConfirmation | null,
  nowMs: number,
): PendingFlightConfirmation | null {
  return liveConfirmation(local, nowMs) ?? liveConfirmation(snapshot, nowMs);
}

export const ActionArm = Object.freeze({
  ARMABLE_ACTIONS,
  SAME_CLICK_FLIGHT_CONFIRM,
  ARM_SETTLE_MS,
  ARM_HOLD_MS,
  IDLE_LABELS,
  ARMED_LABELS,
  isArmableAction,
  isSameClickFlightConfirm,
  interpretArmClick,
  expireArm,
  buttonLabel,
  flightWorkflowAction,
  confirmationMatchesClick,
  confirmationCreatedByRequest,
  flightConfirmDispatch,
  sameClickConfirmDispatch,
  adoptPendingConfirmation,
});
