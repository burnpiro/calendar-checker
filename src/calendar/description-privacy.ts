import type { CalendarEvent } from "./model";
import type { PendingWrite } from "./write-model";

export const DESCRIPTION_PRIVACY_KEY = "privacy:event-descriptions";

export function omitDescription(event: CalendarEvent): CalendarEvent {
  return { ...event, description: "", descriptionOmitted: true };
}

/** Never discard explicitly queued user changes while removing provider content. */
export function omitWriteDescriptions(row: PendingWrite): PendingWrite {
  const patch = { ...row.patch };
  if (row.status === "awaiting-sync") delete patch.description;
  return {
    ...row,
    patch,
    base: row.base ? omitDescription(row.base) : undefined,
    remote: row.remote ? omitDescription(row.remote) : undefined,
    event:
      patch.description !== undefined && row.kind !== "delete"
        ? {
            ...row.event,
            description: patch.description,
            descriptionOmitted: undefined,
          }
        : omitDescription(row.event),
  };
}
