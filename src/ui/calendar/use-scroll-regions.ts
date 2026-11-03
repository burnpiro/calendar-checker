import { useEffect, type RefObject } from "react";

/** Give semantic time-grid cells a keyboard entry point, preserving the calendar's grid roles. */
export function useScrollRegions(
  root: RefObject<HTMLDivElement | null>,
  view: "month" | "week",
) {
  useEffect(() => {
    const element = root.current;
    if (!element || view !== "week") return;
    let frame = 0;
    const owned = new Set<HTMLElement>();
    const update = () => {
      frame = 0;
      if ([...owned].some((slot) => slot === document.activeElement)) return;
      for (const slot of owned) {
        slot.removeAttribute("tabindex");
        slot.removeAttribute("data-calendar-scroll");
      }
      owned.clear();
      const targets = new Map<HTMLElement, HTMLElement>();
      for (const candidate of element.querySelectorAll<HTMLElement>(
        ".calendar-week-day, .calendar-slot-header",
      )) {
        const cell = candidate.matches(".calendar-week-day")
          ? candidate
          : candidate.closest<HTMLElement>('[role="rowheader"]');
        if (!cell || cell.closest('[aria-hidden="true"]')) continue;
        let parent = cell.parentElement;
        while (
          parent &&
          parent !== element &&
          !(
            /auto|scroll/.test(getComputedStyle(parent).overflowY) &&
            parent.scrollHeight > parent.clientHeight + 1
          )
        )
          parent = parent.parentElement;
        if (parent && parent !== element && !targets.has(parent))
          targets.set(parent, cell);
      }
      for (const cell of targets.values()) {
        if (!cell.hasAttribute("tabindex")) {
          cell.tabIndex = 0;
          cell.setAttribute("data-calendar-scroll", "");
          owned.add(cell);
        }
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    const mutation = new MutationObserver(schedule);
    resize.observe(element);
    mutation.observe(element, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    window.addEventListener("resize", schedule);
    element.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    schedule();
    return () => {
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", schedule);
      element.removeEventListener("scroll", schedule, true);
      if (frame) cancelAnimationFrame(frame);
      for (const slot of owned) {
        slot.removeAttribute("tabindex");
        slot.removeAttribute("data-calendar-scroll");
      }
    };
  }, [root, view]);
}
