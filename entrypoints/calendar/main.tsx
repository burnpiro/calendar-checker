import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CalendarApp } from "../../src/ui/calendar/CalendarApp";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CalendarApp />
  </StrictMode>,
);
