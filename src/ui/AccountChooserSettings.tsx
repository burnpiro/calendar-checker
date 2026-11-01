import { useState } from "react";
import type { Command, Settings } from "../shared/model";

export function AccountChooserSettings({
  settings,
  extensionId,
  busy,
  run,
}: {
  settings: Settings;
  extensionId: string;
  busy: boolean;
  run: (command: Command, notice?: string) => Promise<void>;
}) {
  const [clientId, setClientId] = useState(settings.webOAuthClientId);
  return (
    <section className="settings-section">
      <p className="eyebrow">GOOGLE SIGN-IN</p>
      <h2>Google account chooser</h2>
      <p className="muted">
        Use a Web application OAuth client to choose a different Google account
        when adding accounts. Existing connections keep their current sign-in
        method.
      </p>
      <form
        className="settings-form account-chooser-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            {
              type: "UPDATE_SETTINGS",
              settings: { webOAuthClientId: clientId.trim() },
            },
            "Google account chooser saved. Use Add Google account to choose an account.",
          );
        }}
      >
        <label>
          Web application client ID
          <input
            type="text"
            aria-label="Web application client ID"
            aria-describedby="web-client-help"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder="123456789-example.apps.googleusercontent.com"
            autoComplete="off"
            spellCheck={false}
          />
          <small id="web-client-help">
            Public client ID only. Never enter a client secret.
          </small>
        </label>
        <p className="muted">
          In Google Cloud, register this exact authorized redirect URI:
        </p>
        <code className="extension-id">{`https://${extensionId}.chromiumapp.org/`}</code>
        <p className="muted">
          Chrome handles this address locally; no application server is needed.
          Background access depends on your Google sign-in session. If it
          expires, use Reconnect. Saved events remain available.
        </p>
        <button className="button primary" disabled={busy}>
          Save account chooser
        </button>
      </form>
    </section>
  );
}
