export function isTimeZone(value: string): boolean {
  if (value === "device") return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
export function displayTimeZone(preference: string): string {
  return preference === "device"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : preference;
}
