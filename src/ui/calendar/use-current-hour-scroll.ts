import { useEffect, type RefObject } from "react";
import type { CalendarRef } from "@fullcalendar/react";
import { Temporal } from "temporal-polyfill";

export function useCurrentHourScroll(
  root: RefObject<HTMLDivElement | null>,
  calendar: RefObject<CalendarRef | null>,
  view: "month" | "week",
  rangeKey: string,
  zone: string,
  fit: boolean,
  startHour: number,
  endHour: number,
  hourHeight: number,
) {
  useEffect(() => {
    if (view !== "week" || fit || !root.current) return;
    const now = Temporal.Now.zonedDateTimeISO(zone);
    if (now.hour < startHour || now.hour >= endHour) return;
    let frame: number | undefined;
    let finished = false;
    const observer = new ResizeObserver(() => schedule());
    const check = () => {
      frame = undefined;
      const slots = [
        ...root.current!.querySelectorAll<HTMLElement>(
          ".calendar-slot-header[data-time]",
        ),
      ];
      const minutes = now.hour * 60 + now.minute;
      const minuteOf = (slot: HTMLElement) => {
        const [hour = 0, minute = 0] = slot.dataset
          .time!.split(":")
          .map(Number);
        return hour * 60 + minute;
      };
      const index = slots.findLastIndex((slot) => minuteOf(slot) <= minutes);
      const slot = slots[index];
      if (!slot) return;
      const rect = slot.getBoundingClientRect();
      if (!rect.height) return;
      const next = slots[index + 1];
      const previous = slots[index - 1];
      const height = next
        ? next.getBoundingClientRect().top - rect.top
        : previous
          ? rect.top - previous.getBoundingClientRect().top
          : rect.height;
      const interval = next
        ? minuteOf(next) - minuteOf(slot)
        : previous
          ? minuteOf(slot) - minuteOf(previous)
          : 60;
      // FullCalendar measures slot sizes after mounting. Wait for the requested
      // minimum before deciding the hour is visible in the initial layout.
      if (height < (hourHeight * interval) / 60 - 1) return;
      let scroller = slot.parentElement;
      while (
        scroller &&
        !(
          /auto|scroll/.test(getComputedStyle(scroller).overflowY) &&
          scroller.scrollHeight > scroller.clientHeight + 1
        )
      )
        scroller = scroller.parentElement;
      if (scroller) {
        const bounds = scroller.getBoundingClientRect();
        const currentY =
          rect.top + (height * (minutes - minuteOf(slot))) / interval;
        if (currentY < bounds.top + 4 || currentY > bounds.bottom - 4) {
          // Leave a little context above the hour so its label is fully visible.
          calendar.current?.getApi().scrollToTime({
            minutes: Math.max(startHour * 60, now.hour * 60 - 15),
          });
        }
      }
      // This is an entry/layout adjustment, not a timer that overrides manual scrolling.
      finished = true;
      observer.disconnect();
    };
    function schedule() {
      if (!finished && frame === undefined)
        frame = requestAnimationFrame(check);
    }
    observer.observe(root.current);
    const slot = root.current.querySelector(".calendar-slot-header");
    if (slot) observer.observe(slot.parentElement ?? slot);
    schedule();
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [
    root,
    calendar,
    view,
    rangeKey,
    zone,
    fit,
    startHour,
    endHour,
    hourHeight,
  ]);
}
