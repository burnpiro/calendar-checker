import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as Tooltip from "@radix-ui/react-tooltip";
import FullCalendar, {
  type CalendarRef,
  type DatesSetInfo,
  type EventClickInfo,
  type EventDisplayInfo,
  type EventHoveringInfo,
  type MountInfo,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import themePlugin from "@fullcalendar/react/themes/forma";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Globe2,
  Menu,
  PanelLeftClose,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { Temporal } from "temporal-polyfill";
import { getCalendarDatabase } from "../../calendar/database";
import { DEMO_CALENDARS } from "../../calendar/demo";
import {
  EVENT_TYPES,
  EVENT_TYPE_NAMES,
  type CalendarEvent,
  type EventType,
} from "../../calendar/model";
import { dateKey, eventWhen, visibleEvents } from "../../calendar/presentation";
import {
  calendarKey,
  displayTimeZone,
  type Settings,
} from "../../shared/preferences";
import {
  needsReconnect,
  type Snapshot,
  type SettingsPatch,
} from "../../shared/model";
import { sendCommand } from "../client";
import { useExtensionState } from "../use-extension-state";
import { useTheme } from "../use-theme";
import { IconButton } from "./controls";
import { MiniCalendar } from "./MiniCalendar";
import { EventDetails } from "./EventDetails";
import { useSyncMetadata, useConnectionClock } from "../use-sync-metadata";
import {
  coverageStatus,
  preferredCalendarAccounts,
} from "../../calendar/coverage";
import { monthRange } from "../../calendar/sync-model";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/forma/theme.css";
import "@fullcalendar/react/themes/forma/palettes/purple.css";
import "../design.css";
import "./calendar.css";

const plugins = [dayGridPlugin, timeGridPlugin, interactionPlugin, themePlugin];
const viewName = (view: Settings["defaultView"]) =>
  view === "month" ? "dayGridMonth" : "timeGridWeek";
const eventClasses = (info: EventDisplayInfo) =>
  `calendar-event ${info.isStart ? "event-start" : ""}`;

function pastelColor(color: string): string {
  return (
    "#" +
    [1, 3, 5]
      .map((offset) =>
        Math.round(
          parseInt(color.slice(offset, offset + 2), 16) * 0.16 + 255 * 0.84,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function CalendarBody({
  snapshot,
  compact,
  bridge,
}: {
  snapshot: Snapshot;
  compact: boolean;
  bridge: ReturnType<typeof useExtensionState>;
}) {
  const { run, error, busy } = bridge;
  const state = snapshot;
  const settings = state.settings;
  const zone = displayTimeZone(settings.primaryTimeZone);
  const resolvedTheme = useTheme(settings.theme);
  const calendar = useRef<CalendarRef>(null);
  const today = Temporal.Now.plainDateISO(zone).toString();
  const [date, setDate] = useState(today);
  const [title, setTitle] = useState("");
  const [view, setView] = useState(settings.defaultView);
  const [sidebar, setSidebar] = useState(!compact);
  const [query, setQuery] = useState("");
  const [hiddenTypes, setHiddenTypes] = useState<EventType[]>([]);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [tooltip, setTooltip] = useState<{
    event: CalendarEvent;
    x: number;
    y: number;
  } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const focusCleanup = useRef(new WeakMap<HTMLElement, () => void>());
  const [storageError, setStorageError] = useState("");
  const month = date.slice(0, 7) + "-01";
  const [visibleRange, setVisibleRange] = useState(() =>
    monthRange(month, 0, 0),
  );
  const metadata = useSyncMetadata();
  const clock = useConnectionClock();
  const preferred = useMemo(
    () =>
      settings.dataSource === "demo"
        ? undefined
        : preferredCalendarAccounts(
            state.accounts,
            settings,
            metadata,
            visibleRange,
          ),
    [state.accounts, settings, metadata, visibleRange],
  );
  const syncStatus = coverageStatus(
    state.accounts,
    settings,
    metadata,
    visibleRange,
    clock.online,
    clock.now,
  );
  const syncRunning =
    metadata?.states.some(
      (item) =>
        item.running &&
        state.accounts.some(
          (account) => account.enabled && account.id === item.accountId,
        ),
    ) ?? false;
  const previousSync = useRef<string | undefined>(undefined);
  const accountSignature = JSON.stringify(
    state.accounts.map((account) => [
      account.id,
      account.enabled,
      account.calendars.map((item) => item.id),
    ]),
  );
  const rows = useLiveQuery(async () => {
    try {
      const db = getCalendarDatabase();
      return {
        events: await (
          settings.dataSource === "demo" ? db.demoEvents : db.events
        ).toArray(),
        failed: false,
      };
    } catch {
      return { events: [] as CalendarEvent[], failed: true };
    }
  }, [settings.dataSource]);

  useEffect(() => {
    if (settings.dataSource !== "demo") return;
    let active = true;
    void sendCommand({ type: "PREPARE_DEMO", month, timeZone: zone })
      .then(() => {
        if (active) setStorageError("");
      })
      .catch((cause: unknown) => {
        if (active)
          setStorageError(
            cause instanceof Error
              ? cause.message
              : "Sample data could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [month, zone, settings.dataSource]);
  useEffect(() => {
    if (settings.dataSource !== "google" || !clock.online) return;
    const reason =
      previousSync.current && previousSync.current !== month ? "view" : "open";
    previousSync.current = month;
    let active = true;
    void sendCommand({ type: "SYNC_EVENTS", month, reason })
      .then(() => {
        if (active) setStorageError("");
      })
      .catch((cause: unknown) => {
        if (active)
          setStorageError(
            cause instanceof Error
              ? cause.message
              : "Event synchronization could not be started.",
          );
      });
    return () => {
      active = false;
    };
  }, [month, settings.dataSource, accountSignature, clock.online]);
  useEffect(() => {
    if (calendar.current?.getApi().view.type !== viewName(settings.defaultView))
      calendar.current?.getApi().changeView(viewName(settings.defaultView));
  }, [settings.defaultView]);
  useEffect(() => {
    setSelected(null);
    setTooltip(null);
    setQuery("");
  }, [settings.dataSource]);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const filtered = useMemo(
    () =>
      visibleEvents(
        rows?.events ?? [],
        settings,
        state.accounts,
        query,
        hiddenTypes,
        preferred,
      ),
    [rows?.events, settings, state.accounts, query, hiddenTypes, preferred],
  );
  const eventMap = useMemo(
    () => new Map(filtered.map((event) => [event.key, event])),
    [filtered],
  );
  const liveEvents = useRef(eventMap);
  liveEvents.current = eventMap;
  const mountedEvents = useRef(new Map<HTMLElement, string>());
  useEffect(() => {
    setSelected((current) =>
      current ? (eventMap.get(current.key) ?? null) : null,
    );
    clearTimeout(hoverTimer.current);
    setTooltip(null);
    for (const [el, id] of mountedEvents.current) {
      const event = eventMap.get(id);
      if (event)
        el.setAttribute(
          "aria-label",
          `${event.title}, ${eventWhen(event, zone, settings.timeFormat)}, ${event.calendarName}`,
        );
    }
  }, [eventMap, zone, settings.timeFormat]);
  const inputs = useMemo(
    () =>
      filtered.map((event) => ({
        id: event.key,
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        color:
          event.allDay || view === "week"
            ? pastelColor(event.color)
            : event.color,
        contrastColor: event.allDay || view === "week" ? "#353245" : "#ffffff",
        extendedProps: { record: event },
      })),
    [filtered, view],
  );
  const patch = (value: SettingsPatch) => {
    void run({ type: "UPDATE_SETTINGS", settings: value });
  };
  const hidePreview = useCallback(() => {
    clearTimeout(hoverTimer.current);
    setTooltip(null);
  }, []);
  const preview = useCallback(
    (event: CalendarEvent, el: HTMLElement, delay: number) => {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => {
        const rect = el.getBoundingClientRect();
        setTooltip({
          event,
          x: Math.max(12, Math.min(rect.left, window.innerWidth - 310)),
          y: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 230)),
        });
      }, delay);
    },
    [],
  );
  const handleEnter = useCallback(
    (info: EventHoveringInfo) => {
      const event = eventMap.get(info.event.id);
      if (event) preview(event, info.el, 1000);
    },
    [eventMap, preview],
  );
  const handleMount = useCallback(
    (info: MountInfo<EventDisplayInfo>) => {
      const el = info.el;
      const event = info.event.extendedProps.record as CalendarEvent;
      el.dataset.eventShape = event.allDay
        ? "all-day"
        : info.view.type === "timeGridWeek"
          ? "week-block"
          : "row";
      el.style.setProperty("--event-accent", event.color);
      el.setAttribute(
        "aria-label",
        `${event.title}, ${eventWhen(event, zone, settings.timeFormat)}, ${event.calendarName}`,
      );
      mountedEvents.current.set(el, event.key);
      const show = () => {
        const latest = liveEvents.current.get(event.key);
        if (latest) preview(latest, el, 0);
      };
      el.addEventListener("focus", show);
      el.addEventListener("blur", hidePreview);
      focusCleanup.current.set(el, () => {
        el.removeEventListener("focus", show);
        el.removeEventListener("blur", hidePreview);
      });
    },
    [zone, settings.timeFormat, preview, hidePreview],
  );
  const handleClick = useCallback(
    (info: EventClickInfo) => {
      hidePreview();
      setSelected(info.event.extendedProps.record as CalendarEvent);
    },
    [hidePreview],
  );
  const handleDates = useCallback(
    (info: DatesSetInfo) => {
      setTitle(info.view.title);
      setView(info.view.type === "timeGridWeek" ? "week" : "month");
      setDate(dateKey(info.view.calendar.getDate(), zone));
      setVisibleRange({
        start: dateKey(info.start, zone),
        end: dateKey(info.end, zone),
      });
      hidePreview();
    },
    [zone, hidePreview],
  );
  const timeFormat = useMemo(
    () => ({
      hour: "numeric" as const,
      minute: "2-digit" as const,
      hour12: settings.timeFormat === "12h",
    }),
    [settings.timeFormat],
  );
  const reconnectCount = state.accounts.filter(needsReconnect).length;
  const demo = settings.dataSource === "demo";
  const sourceCalendars = demo
    ? DEMO_CALENDARS.map((item) => ({
        accountId: item.accountId,
        calendarId: item.id,
        name: item.name,
        accountName: item.accountName,
        color: item.color,
        enabled: true,
      }))
    : state.accounts.flatMap((account, index) =>
        account.calendars.map((item) => ({
          accountId: account.id,
          calendarId: item.id,
          name: item.summary,
          accountName: account.email,
          color:
            item.backgroundColor ??
            ["#7765d8", "#348e81", "#c58a35"][index % 3]!,
          enabled: account.enabled,
        })),
      );
  return (
    <Tooltip.Provider delayDuration={500}>
      <div
        className={`calendar-app ${compact ? "calendar-popup" : "calendar-page"} density-${settings.density} ${sidebar ? "sidebar-open" : "sidebar-closed"}`}
      >
        {sidebar && (
          <aside className="calendar-sidebar" aria-label="Calendar sidebar">
            <div className="sidebar-brand">
              <span className="calendar-logo">
                <CalendarDays size={23} />
              </span>
              <div>
                Calendar<span>Make room for your day.</span>
              </div>
              <IconButton
                label="Close sidebar"
                onClick={() => setSidebar(false)}
              >
                <PanelLeftClose size={17} />
              </IconButton>
            </div>
            <MiniCalendar
              date={date}
              weekStartsOn={settings.weekStartsOn}
              onSelect={(value) => calendar.current?.getApi().gotoDate(value)}
            />
            <div className="sidebar-section-title">
              {demo ? "DEMO CALENDARS" : "YOUR CALENDARS"}
              <span>{sourceCalendars.length}</span>
            </div>
            <div className="calendar-list">
              {sourceCalendars.map((item) => {
                const key = calendarKey(item.accountId, item.calendarId);
                return (
                  <label
                    key={key}
                    className={`calendar-list-item ${!item.enabled ? "calendar-paused" : ""}`}
                  >
                    <input
                      type="checkbox"
                      style={{ accentColor: item.color }}
                      checked={settings.calendarVisibility[key] !== false}
                      disabled={busy || !item.enabled}
                      onChange={(event) =>
                        patch({
                          calendarVisibility: {
                            [key]: event.target.checked,
                          },
                        })
                      }
                    />
                    <span className="calendar-list-name">
                      {item.name}
                      <small>{item.accountName}</small>
                    </span>
                    <span
                      className="calendar-color"
                      style={{ background: item.color }}
                    />
                  </label>
                );
              })}
              {!sourceCalendars.length && (
                <p className="sidebar-note">
                  Connect an account in Settings to see its calendars here.
                </p>
              )}
            </div>
            <details className="type-filters">
              <summary>Event types</summary>
              <div>
                {EVENT_TYPES.map((type) => (
                  <label key={type}>
                    <input
                      type="checkbox"
                      checked={!hiddenTypes.includes(type)}
                      onChange={(event) =>
                        setHiddenTypes((previous) =>
                          event.target.checked
                            ? previous.filter((item) => item !== type)
                            : [...previous, type],
                        )
                      }
                    />
                    {EVENT_TYPE_NAMES[type]}
                  </label>
                ))}
              </div>
            </details>
            <div className="sidebar-bottom">
              <span>
                <ShieldCheck size={15} />
                Stored on your device
              </span>
              <button
                className="sidebar-settings"
                onClick={() => void chrome.runtime.openOptionsPage()}
              >
                <Settings2 size={17} /> Accounts & settings
                {reconnectCount > 0 && (
                  <span className="attention-dot">{reconnectCount}</span>
                )}
              </button>
              <p>
                {demo
                  ? "Explore with sample events. Your Google accounts stay connected."
                  : `${state.accounts.length} connected account${state.accounts.length === 1 ? "" : "s"}`}
              </p>
            </div>
          </aside>
        )}
        <main className="calendar-main">
          <header className="calendar-toolbar">
            <div className="calendar-navigation">
              {!sidebar && (
                <IconButton
                  label="Open sidebar"
                  onClick={() => setSidebar(true)}
                >
                  <Menu size={19} />
                </IconButton>
              )}
              <button
                className="today-button"
                onClick={() => calendar.current?.getApi().today()}
              >
                Today
              </button>
              <div className="date-arrows">
                <IconButton
                  label="Previous period"
                  onClick={() => calendar.current?.getApi().prev()}
                >
                  <ChevronLeft size={18} />
                </IconButton>
                <IconButton
                  label="Next period"
                  onClick={() => calendar.current?.getApi().next()}
                >
                  <ChevronRight size={18} />
                </IconButton>
              </div>
              <h1 aria-live="polite">{title || "Your calendar"}</h1>
            </div>
            <div className="calendar-tools">
              <label className="calendar-search">
                <Search size={16} />
                <input
                  type="search"
                  placeholder="Search events"
                  aria-label="Search events"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                  <button
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                  >
                    <X size={13} />
                  </button>
                )}
              </label>
              <div className="view-switch" aria-label="Calendar view">
                <button
                  aria-pressed={view === "month"}
                  onClick={() => {
                    calendar.current?.getApi().changeView("dayGridMonth");
                    patch({ defaultView: "month" });
                  }}
                >
                  Month
                </button>
                <button
                  aria-pressed={view === "week"}
                  onClick={() => {
                    calendar.current?.getApi().changeView("timeGridWeek");
                    patch({ defaultView: "week" });
                  }}
                >
                  Week
                </button>
              </div>
              {!demo && (
                <IconButton
                  label="Sync events"
                  disabled={
                    busy ||
                    syncRunning ||
                    !clock.online ||
                    !state.accounts.some((account) => account.enabled)
                  }
                  onClick={() =>
                    void run({ type: "SYNC_EVENTS", month, reason: "manual" })
                  }
                >
                  <RefreshCw size={16} />
                </IconButton>
              )}
              {compact && (
                <IconButton
                  label="Open full calendar"
                  onClick={() =>
                    void chrome.tabs.create({
                      url: chrome.runtime.getURL("/calendar.html"),
                    })
                  }
                >
                  <ExternalLink size={16} />
                </IconButton>
              )}
              <IconButton
                label={compact ? "Settings" : "Accounts and settings"}
                onClick={() => void chrome.runtime.openOptionsPage()}
              >
                <Settings2 size={18} />
              </IconButton>
            </div>
          </header>
          <div className="calendar-context">
            <div>
              <span className={`data-mode ${demo ? "demo-mode" : ""}`}>
                {demo ? <Sparkles size={13} /> : <CalendarDays size={13} />}
                {demo ? "Demo preview" : "My calendars"}
              </span>
              <span className="zone-label">
                <Globe2 size={12} />
                {zone.replaceAll("_", " ")}
              </span>
              {compact && (
                <span className="compact-data-note">
                  {demo ? "Local sample events" : syncStatus.short}
                </span>
              )}
            </div>
            <button
              className="small-link"
              onClick={() => patch({ dataSource: demo ? "google" : "demo" })}
            >
              {demo ? "Show my calendars" : "Try demo preview"}
            </button>
          </div>
          {reconnectCount > 0 && (
            <div className="calendar-notice reconnect-notice" role="alert">
              {reconnectCount} account
              {reconnectCount === 1 ? " needs" : "s need"} reconnecting.{" "}
              {state.accounts
                .filter(needsReconnect)
                .map((account) => account.email)
                .join(", ")}{" "}
              <button onClick={() => void chrome.runtime.openOptionsPage()}>
                Open account settings
              </button>
            </div>
          )}
          {(error || storageError || rows?.failed) && (
            <div className="calendar-notice error-notice" role="alert">
              {error ||
                storageError ||
                "Local event data could not be opened. Your account settings are still available."}
            </div>
          )}
          {!demo && syncStatus.warning && (
            <div className="calendar-sync-notice" role="status">
              {syncStatus.message}
            </div>
          )}
          {!compact && demo && (
            <div className="preview-note">
              <Sparkles size={14} />
              <span>
                Sample events, just for exploring. Nothing here is sent to
                Google.
              </span>
            </div>
          )}
          <div className="calendar-viewport" data-testid="calendar-grid">
            <FullCalendar
              ref={calendar}
              plugins={plugins}
              initialView={viewName(settings.defaultView)}
              initialDate={today}
              timeZone={zone}
              headerToolbar={false}
              height="100%"
              firstDay={settings.weekStartsOn}
              weekends={settings.showWeekends}
              events={inputs}
              editable={false}
              eventInteractive
              dayMaxEvents={compact ? true : 3}
              fixedWeekCount
              expandRows
              nowIndicator
              colorScheme={resolvedTheme}
              slotMinTime={`${String(settings.weekStartHour).padStart(2, "0")}:00:00`}
              slotMaxTime={`${String(settings.weekEndHour).padStart(2, "0")}:00:00`}
              scrollTime={`${String(settings.weekStartHour).padStart(2, "0")}:00:00`}
              eventTimeFormat={timeFormat}
              slotHeaderFormat={timeFormat}
              slotDuration={compact ? "01:00:00" : "00:30:00"}
              slotMinHeight={compact ? 0 : undefined}
              slotHeaderClass="calendar-slot-header"
              slotHeaderInnerClass="calendar-slot-label"
              eventClass={eventClasses}
              eventTitleClass="calendar-event-title"
              eventTimeClass="calendar-event-time"
              moreLinkClass="calendar-more-link"
              moreLinkInnerClass="calendar-more-text"
              dayRowClass="calendar-day-row"
              dayCellInnerClass="calendar-cell-inner"
              dayCellTopClass="calendar-day-top"
              dayCellTopInnerClass="calendar-day-number"
              dayCellClass={(info) =>
                `calendar-day-cell ${
                  info.isToday
                    ? "calendar-today"
                    : info.isOther
                      ? "calendar-other-month"
                      : ""
                }`
              }
              eventClick={handleClick}
              eventMouseEnter={handleEnter}
              eventMouseLeave={hidePreview}
              eventDidMount={handleMount}
              eventWillUnmount={(info) => {
                focusCleanup.current.get(info.el)?.();
                mountedEvents.current.delete(info.el);
              }}
              datesSet={handleDates}
            />
          </div>
          <footer className="calendar-footer">
            <span>
              <span className="status-dot" />
              {demo ? "Local sample data" : syncStatus.short}
            </span>
            <span>
              {filtered.length} event{filtered.length === 1 ? "" : "s"}
              {query || hiddenTypes.length
                ? " matching filters"
                : " in local storage"}
            </span>
            {!compact && (
              <button
                className="small-link"
                disabled={busy}
                onClick={() => void run({ type: "CHECK_ALL" })}
              >
                <RefreshCw size={12} /> Check account connections
              </button>
            )}
          </footer>
        </main>
        <EventDetails
          event={selected}
          onClose={() => setSelected(null)}
          timeZone={zone}
          format={settings.timeFormat}
        />
        {tooltip &&
          !selected &&
          createPortal(
            <div
              className="event-hover-card"
              role="tooltip"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              <span
                className="hover-calendar"
                style={{
                  borderInlineStart: `3px solid ${tooltip.event.color}`,
                }}
              >
                {tooltip.event.calendarName}
              </span>
              <strong>{tooltip.event.title}</strong>
              <p>{eventWhen(tooltip.event, zone, settings.timeFormat)}</p>
              {tooltip.event.location && (
                <small>{tooltip.event.location}</small>
              )}
            </div>,
            document.body,
          )}
      </div>
    </Tooltip.Provider>
  );
}

export function CalendarApp({ compact = false }: { compact?: boolean }) {
  const bridge = useExtensionState();
  const { state, error } = bridge;
  return state ? (
    <CalendarBody snapshot={state} compact={compact} bridge={bridge} />
  ) : (
    <div
      className={`calendar-loading ${compact ? "calendar-popup" : ""}`}
      role={error ? "alert" : "status"}
    >
      {error || "Opening your calendar…"}
    </div>
  );
}
