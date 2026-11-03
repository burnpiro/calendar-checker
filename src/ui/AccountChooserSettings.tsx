import {
  AutoSaveStatus,
  useAutoSavePreferences,
} from "./use-auto-save-preferences";
import type { Settings } from "../shared/model";

export function AccountChooserSettings({
  settings,
  extensionId,
}: {
  settings: Settings;
  extensionId: string;
}) {
  const save = useAutoSavePreferences(
    settings,
    (s) => ({ webOAuthClientId: s.webOAuthClientId }),
    (d) => ({ webOAuthClientId: d.webOAuthClientId.trim() }),
  );
  const clientId = save.draft.webOAuthClientId;
  const setClientId = (value: string) =>
    save.setDraft({ webOAuthClientId: value });
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
        onSubmit={(event) => event.preventDefault()}
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
        <AutoSaveStatus {...save} />
      </form>
    </section>
  );
}
