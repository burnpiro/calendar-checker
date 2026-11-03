import { useEffect, useState, useSyncExternalStore } from "react";
import type { Settings } from "../shared/model";
import { sendCommand } from "./client";
import {
  PreferenceAutosave,
  type AutosaveSnapshot,
} from "./preference-autosave";

export function useAutoSavePreferences<T>(
  settings: Settings,
  makeDraft: (settings: Settings) => T,
  toPatch: (draft: T) => unknown,
) {
  const [controller] = useState(
    () =>
      new PreferenceAutosave(
        settings,
        makeDraft,
        toPatch,
        async (patch) =>
          (await sendCommand({ type: "UPDATE_SETTINGS", settings: patch }))
            .state.settings,
      ),
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  useEffect(() => controller.sync(settings), [controller, settings]);
  return { ...snapshot, setDraft: controller.edit, retry: controller.retry };
}

export function AutoSaveStatus<T>({
  status,
  message,
  retry,
}: Pick<AutosaveSnapshot<T>, "status" | "message"> & { retry: () => void }) {
  return (
    <div
      className={`autosave-status autosave-${status}`}
      data-save-state={status}
      aria-live="polite"
    >
      <span>{message}</span>
      {status === "error" && (
        <button type="button" className="button subtle" onClick={retry}>
          Retry saving
        </button>
      )}
    </div>
  );
}
