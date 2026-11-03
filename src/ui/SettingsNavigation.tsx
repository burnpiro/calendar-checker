import {
  Bell,
  CalendarDays,
  CloudDownload,
  Pencil,
  UsersRound,
  Wrench,
  Stethoscope,
} from "lucide-react";
import { useEffect, useState } from "react";

const groups = [
  {
    title: "Everyday",
    links: [
      { id: "accounts", label: "Accounts", icon: UsersRound },
      { id: "appearance", label: "Calendar & time zones", icon: CalendarDays },
      { id: "notifications", label: "Notifications & sounds", icon: Bell },
      { id: "event-defaults", label: "Event defaults", icon: Pencil },
    ],
  },
  {
    title: "Advanced",
    links: [
      { id: "sync", label: "Sync & offline storage", icon: CloudDownload },
      { id: "connection-settings", label: "Connection & setup", icon: Wrench },
      { id: "diagnostics", label: "Diagnostics", icon: Stethoscope },
    ],
  },
];

export function SettingsNavigation() {
  const [active, setActive] = useState(
    () => window.location.hash.slice(1) || "accounts",
  );
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const sections = groups
        .flatMap((group) => group.links)
        .map((link) => {
          const element = document.getElementById(link.id);
          return element
            ? { id: link.id, rect: element.getBoundingClientRect() }
            : undefined;
        })
        .filter((section) => section !== undefined);
      const visible = sections.filter(
        (section) =>
          section.rect.bottom > 0 && section.rect.top < window.innerHeight,
      );
      if (!visible.length) return;
      const line = Math.min(180, Math.max(80, window.innerHeight * 0.22));
      const passed = visible.filter((section) => section.rect.top <= line);
      const atBottom =
        window.scrollY > 0 &&
        Math.ceil(window.scrollY + window.innerHeight) >=
          document.documentElement.scrollHeight - 2;
      setActive(
        (atBottom ? visible.at(-1) : (passed.at(-1) ?? visible[0]))!.id,
      );
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const followHash = () => {
      const target = document.getElementById(window.location.hash.slice(1));
      if (target instanceof HTMLDetailsElement) target.open = true;
      schedule();
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", followHash);
    document.addEventListener("toggle", schedule, true);
    const observer = new ResizeObserver(schedule);
    const content = document.querySelector(".settings-content");
    if (content) observer.observe(content);
    followHash();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", followHash);
      document.removeEventListener("toggle", schedule, true);
    };
  }, []);

  return (
    <nav className="settings-navigation" aria-label="Settings sections">
      {groups.map((group) => (
        <div key={group.title}>
          <p>{group.title}</p>
          {group.links.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={active === id ? "location" : undefined}
              onClick={() => {
                const target = document.getElementById(id);
                if (target instanceof HTMLDetailsElement) target.open = true;
              }}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
            </a>
          ))}
        </div>
      ))}
      <small>Your preferences stay on this device.</small>
    </nav>
  );
}
