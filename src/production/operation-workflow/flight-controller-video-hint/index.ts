const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);

export const FLIGHT_CONTROLLER_VIDEO_HINT =
  "飞控尚未连接。请转动遥控器摇杆或重启飞机；连上后再点一次开始。";

export interface FlightControllerVideoHintInput {
  readonly hasConnectedOnce: unknown;
  readonly streaming: unknown;
  readonly fps: unknown;
}

export interface FlightControllerVideoHint {
  readonly banner: string | null;
  readonly afterStart: string | null;
}

const evaluate = (input: FlightControllerVideoHintInput): FlightControllerVideoHint => {
  const neverConnected = input.hasConnectedOnce === false;
  const banner = neverConnected ? FLIGHT_CONTROLLER_VIDEO_HINT : null;
  const fpsIsZero = input.fps === 0;
  const streaming = input.streaming === true;
  const afterStart = neverConnected && streaming && fpsIsZero ? FLIGHT_CONTROLLER_VIDEO_HINT : null;
  return freeze({ banner, afterStart });
};

export const FlightControllerVideoHint = freeze({ evaluate });
