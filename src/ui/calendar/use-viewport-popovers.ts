import { useLayoutEffect } from "react";

const selector = ".calendar-event-popover, .event-hover-card";
const margin = 12;

/** Keep portalled calendar panels inside the actual viewport Chrome grants. */
export function useViewportPopovers() {
  useLayoutEffect(() => {
    let frame: number | undefined;
    const observed = new Set<HTMLElement>();
    const resize = new ResizeObserver(() => schedule());
    const fit = () => {
      frame = undefined;
      for (const element of observed) {
        if (!element.isConnected) {
          resize.unobserve(element);
          observed.delete(element);
        }
      }
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        if (!observed.has(element)) {
          observed.add(element);
          resize.observe(element);
        }
        const rect = element.getBoundingClientRect();
        const left = Math.max(
          margin,
          Math.min(rect.left, window.innerWidth - margin - rect.width),
        );
        const top = Math.max(
          margin,
          Math.min(rect.top, window.innerHeight - margin - rect.height),
        );
        // FullCalendar uses offset-parent coordinates; add viewport deltas rather
        // than replacing them with viewport coordinates. Hover cards are fixed.
        if (Math.abs(left - rect.left) > 0.5)
          element.style.left = `${(parseFloat(element.style.left) || 0) + left - rect.left}px`;
        if (Math.abs(top - rect.top) > 0.5)
          element.style.top = `${(parseFloat(element.style.top) || 0) + top - rect.top}px`;
      }
    };
    function schedule() {
      if (frame === undefined) frame = requestAnimationFrame(fit);
    }
    const mutations = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.type === "childList" ||
            (record.target instanceof Element &&
              record.target.matches(selector)),
        )
      )
        schedule();
    });
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      mutations.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, []);
}
