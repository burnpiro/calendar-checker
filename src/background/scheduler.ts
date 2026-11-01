import { AUTH_ALARM } from "../shared/model";

interface AlarmPort {
  get(name: string): Promise<{ periodInMinutes?: number } | undefined>;
  create(
    name: string,
    info: { delayInMinutes: number; periodInMinutes: number },
  ): Promise<void>;
}

export async function ensureConnectionAlarm(
  alarms: AlarmPort,
  minutes: number,
): Promise<void> {
  const current = await alarms.get(AUTH_ALARM);
  // Waking the worker should not continually postpone an already scheduled check.
  if (current?.periodInMinutes === minutes) return;
  await alarms.create(AUTH_ALARM, {
    delayInMinutes: minutes,
    periodInMinutes: minutes,
  });
}
