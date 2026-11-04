const screens = {
  month: {
    title: "See the month.\nKeep the context.",
    copy: "Bring work and personal calendars into a single view. Calendar colors, all-day events and shared availability help you see what is coming.",
    alt: "Light month view with calendars grouped by account and color-coded events",
  },
  week: {
    title: "Give each hour\na little clarity.",
    copy: "Keep hours readable and scroll when you need more room. A second time zone helps you line up meetings across locations.",
    alt: "Week view with colored appointments and aligned Warsaw and New York time zones",
  },
  editor: {
    title: "More than\na title and time.",
    copy: "Choose a calendar, add guests and Google Meet, set visibility and event notifications, and save your plans without switching tabs.",
    alt: "Event editor for choosing a calendar, dates and times, with location and notes",
  },
  reminders: {
    title: "A nudge,\non your terms.",
    copy: "Choose desktop and sound alerts, snooze presets, custom sounds and quiet hours. Your choices save automatically.",
    alt: "Notification settings with sound controls, snooze timing and Do not disturb",
  },
  dark: {
    title: "A quieter look\nfor later hours.",
    copy: "Use light, dark or your device's theme. Choose a compact layout or give your plans a little more room.",
    alt: "Dark month view with fictional work and personal events",
  },
  popup: {
    title: "Your next stop,\none click away.",
    copy: "Check a full month or week from the toolbar. Open the larger calendar when you want more room to plan.",
    alt: "The 800 by 600 calendar popup with a month of fictional events",
  },
};
const tabs = [...document.querySelectorAll("[data-screen]")];
const image = document.getElementById("screen-image");
const download = document.getElementById("download-screen");
let selected = "month";
function selectScreen(name, focus = false) {
  if (!screens[name]) return;
  selected = name;
  tabs.forEach((tab) => {
    const active = tab.dataset.screen === name;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  });
  const info = screens[name];
  image.src = `assets/screens/${name}.png`;
  image.alt = info.alt;
  document.getElementById("screen-title").textContent = info.title;
  document.getElementById("screen-copy").textContent = info.copy;
  document.getElementById("screen-number").textContent =
    `${String(Object.keys(screens).indexOf(name) + 1).padStart(2, "0")} / 06`;
  document
    .getElementById("screen-panel")
    .setAttribute("aria-labelledby", `tab-${name}`);
  download.href = image.src;
  download.download = `calendar-checker-${name}.png`;
}
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectScreen(tab.dataset.screen));
  tab.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft")
      next = (index + tabs.length - 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      selectScreen(tabs[next].dataset.screen, true);
    }
  });
});
document
  .querySelectorAll("[data-select-screen]")
  .forEach((link) =>
    link.addEventListener("click", () =>
      selectScreen(link.dataset.selectScreen),
    ),
  );
const dialog = document.getElementById("image-dialog");
const largeImage = document.getElementById("large-image");
document.getElementById("enlarge-screen").addEventListener("click", () => {
  largeImage.src = image.src;
  largeImage.alt = screens[selected].alt;
  dialog.showModal();
});
document
  .getElementById("close-image")
  .addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  }
});
