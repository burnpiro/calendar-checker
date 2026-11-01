import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import { publicKey } from "./config/extension-key.json";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: () => {
    const clientId = import.meta.env.WXT_GOOGLE_CLIENT_ID?.trim();
    if (
      clientId &&
      !/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)
    ) {
      throw new Error(
        "WXT_GOOGLE_CLIENT_ID must be a Google OAuth client ID, not a secret.",
      );
    }
    return {
      name: "Calendar Checker",
      description: "Your Google calendars, together on your device.",
      minimum_chrome_version: "120",
      key: publicKey,
      permissions: ["identity", "storage", "alarms"],
      host_permissions: ["https://www.googleapis.com/*"],
      action: { default_title: "Calendar Checker" },
      icons: {
        16: "icon/16.png",
        32: "icon/32.png",
        48: "icon/48.png",
        128: "icon/128.png",
      },
      ...(clientId
        ? {
            oauth2: {
              client_id: clientId,
              scopes: [
                "openid",
                "https://www.googleapis.com/auth/userinfo.email",
                "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
                "https://www.googleapis.com/auth/calendar.events.readonly",
              ],
            },
          }
        : {}),
    };
  },
});
