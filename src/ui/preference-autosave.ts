import {
  settingsPatchSchema,
  settingsSchema,
  type Settings,
  type SettingsPatch,
} from "../shared/preferences";

const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const record = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === "object" && !Array.isArray(v));

/** Preserve external updates to fields the user has not edited. Arrays are atomic. */
function editedValue(
  before: unknown,
  draft: unknown,
  latest: unknown,
): unknown {
  if (equal(before, draft)) return structuredClone(latest);
  if (record(before) && record(draft) && record(latest)) {
    const result = { ...latest };
    for (const key of new Set([
      ...Object.keys(before),
      ...Object.keys(draft),
    ])) {
      if (equal(before[key], draft[key])) continue;
      if (!(key in draft)) delete result[key];
      else result[key] = editedValue(before[key], draft[key], latest[key]);
    }
    return result;
  }
  return structuredClone(draft);
}

export const numericPreference = (value: number | string) =>
  typeof value === "string" && value.trim() === "" ? NaN : Number(value);

export interface AutosaveSnapshot<T> {
  draft: T;
  status: "saved" | "saving" | "invalid" | "error";
  message: string;
}

/** Only validated, changed preference fields reach the existing worker writer. */
export class PreferenceAutosave<T> {
  private settings: Settings;
  private baseline: T;
  private dirty = false;
  private running = false;
  private readonly listeners = new Set<() => void>();
  private snapshot: AutosaveSnapshot<T>;
  constructor(
    settings: Settings,
    private readonly makeDraft: (settings: Settings) => T,
    private readonly toPatch: (draft: T) => unknown,
    private readonly persist: (patch: SettingsPatch) => Promise<Settings>,
  ) {
    this.settings = settings;
    this.baseline = makeDraft(settings);
    this.snapshot = {
      draft: structuredClone(this.baseline),
      status: "saved",
      message: "Valid changes save automatically.",
    };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(next: Partial<AutosaveSnapshot<T>>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener();
  }
  sync(settings: Settings) {
    if (settings === this.settings) return;
    const baseline = this.makeDraft(settings);
    const draft = this.dirty
      ? (editedValue(this.baseline, this.snapshot.draft, baseline) as T)
      : structuredClone(baseline);
    this.settings = settings;
    this.baseline = baseline;
    this.publish({ draft });
    if (this.dirty && this.snapshot.status !== "error") void this.flush();
  }
  edit = (update: T | ((current: T) => T)) => {
    const draft =
      typeof update === "function"
        ? (update as (current: T) => T)(this.snapshot.draft)
        : update;
    this.dirty = true;
    this.publish({ draft });
    void this.flush();
  };
  retry = () => {
    void this.flush();
  };
  private async flush() {
    if (this.running || !this.dirty) return;
    this.running = true;
    try {
      while (this.dirty) {
        let patch: SettingsPatch;
        try {
          const before = settingsPatchSchema.parse(this.toPatch(this.baseline));
          const desired = settingsPatchSchema.parse(
            this.toPatch(this.snapshot.draft),
          );
          const changed: Record<string, unknown> = {};
          for (const key of Object.keys(desired) as (keyof SettingsPatch)[]) {
            if (!equal(before[key], desired[key])) {
              const value = editedValue(
                before[key],
                desired[key],
                this.settings[key],
              );
              if (!equal(value, this.settings[key])) changed[key] = value;
            }
          }
          patch = settingsPatchSchema.parse(changed);
          settingsSchema.parse({ ...this.settings, ...patch });
        } catch {
          this.publish({
            status: "invalid",
            message:
              "Not saved. Check the entered values; your last valid settings are kept.",
          });
          return;
        }
        if (!Object.keys(patch).length) {
          this.dirty = false;
          this.publish({ status: "saved", message: "Saved automatically." });
          return;
        }
        const sentDraft = structuredClone(this.snapshot.draft);
        this.publish({ status: "saving", message: "Saving changes…" });
        let saved: Settings;
        try {
          saved = await this.persist(patch);
        } catch (error) {
          this.publish({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Could not save preferences. Try again.",
          });
          return;
        }
        const baseline = this.makeDraft(saved);
        const draft = editedValue(
          sentDraft,
          this.snapshot.draft,
          baseline,
        ) as T;
        this.settings = saved;
        this.baseline = baseline;
        this.publish({ draft });
      }
    } finally {
      this.running = false;
    }
  }
}
