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
    const changed = () =>
      setActive(window.location.hash.slice(1) || "accounts");
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
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
