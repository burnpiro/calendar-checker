import * as Dialog from "@radix-ui/react-dialog";
import { CalendarDays, Clock3, MapPin, UserRound, X } from "lucide-react";
import { EVENT_TYPE_NAMES, type CalendarEvent } from "../../calendar/model";
import { eventWhen } from "../../calendar/presentation";
import type { Settings } from "../../shared/preferences";

export function EventDetails({
  event,
  onClose,
  timeZone,
  format,
}: {
  event: CalendarEvent | null;
  onClose: () => void;
  timeZone: string;
  format: Settings["timeFormat"];
}) {
  return (
    <Dialog.Root
      open={Boolean(event)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="event-dialog"
          aria-describedby="event-description"
        >
          {event && (
            <>
              <div className="event-detail-heading">
                <span
                  className="event-type-chip"
                  style={{ borderColor: event.color }}
                >
                  {EVENT_TYPE_NAMES[event.eventType]}
                </span>
                <Dialog.Close
                  className="icon-button"
                  aria-label="Close event details"
                >
                  <X size={18} />
                </Dialog.Close>
              </div>
              <Dialog.Title className="event-detail-title">
                {event.title}
              </Dialog.Title>
              <div className="event-detail-lines">
                <p>
                  <Clock3 size={17} />
                  <span>
                    {eventWhen(event, timeZone, format)}
                    <small>{event.allDay ? "Date-only event" : timeZone}</small>
                  </span>
                </p>
                <p>
                  <CalendarDays size={17} />
                  <span>{event.calendarName}</span>
                </p>
                <p>
                  <UserRound size={17} />
                  <span>{event.accountName}</span>
                </p>
                {event.location && (
                  <p>
                    <MapPin size={17} />
                    <span>{event.location}</span>
                  </p>
                )}
                {event.organizer && (
                  <p>
                    <UserRound size={17} />
                    <span>
                      Organizer: {event.organizer}
                      {event.attendeeCount !== undefined && (
                        <small>
                          {event.attendeeCount} attendees
                          {event.responseStatus
                            ? ` · Your response: ${event.responseStatus}`
                            : ""}
                        </small>
                      )}
                    </span>
                  </p>
                )}
                {event.recurringEventId && (
                  <p>
                    <CalendarDays size={17} />
                    <span>
                      Recurring event instance
                      <small>Original time zone: {event.timeZone}</small>
                    </span>
                  </p>
                )}
              </div>
              <Dialog.Description
                id="event-description"
                className="event-description"
              >
                {event.description || "No description."}
              </Dialog.Description>
              {(event.htmlLink || event.meetingLink) && (
                <div className="event-links">
                  {event.htmlLink && (
                    <a
                      href={event.htmlLink}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open in Google Calendar ↗
                    </a>
                  )}
                  {event.meetingLink && (
                    <a
                      href={event.meetingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Join meeting ↗
                    </a>
                  )}
                </div>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
