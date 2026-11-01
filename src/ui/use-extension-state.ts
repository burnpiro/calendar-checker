import { useCallback, useEffect, useState } from "react";
import { STORAGE_KEY, type Command, type Snapshot } from "../shared/model";
import { sendCommand } from "./client";

export function useExtensionState() {
  const [state, setState] = useState<Snapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState("");
  const [progress, setProgress] = useState("");
  const reload = useCallback(async () => {
    const reply = await sendCommand({ type: "GET_STATE" });
    setState(reply.state);
  }, []);
  useEffect(() => {
    let active = true;
    const load = () => {
      void sendCommand({ type: "GET_STATE" })
        .then((reply) => {
          if (active) setState(reply.state);
        })
        .catch((cause: unknown) => {
          if (active)
            setError(
              cause instanceof Error
                ? cause.message
                : "Unable to load preferences.",
            );
        });
    };
    load();
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[STORAGE_KEY]) load();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);
  const run = useCallback(
    async (command: Command, success = "") => {
      setProgress(
        command.type === "CONNECT" || command.type === "RECONNECT"
          ? "Waiting for Google sign-in…"
          : command.type === "CHECK" || command.type === "CHECK_ALL"
            ? "Checking Google access…"
            : "Updating local settings…",
      );
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const reply = await sendCommand(command);
        setState(reply.state);
        if (reply.diagnostics)
          setReport(JSON.stringify(reply.diagnostics, null, 2));
        setNotice(success);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The operation could not be completed.",
        );
        await reload().catch(() => undefined);
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );
  return {
    state,
    busy,
    error,
    notice,
    report,
    progress,
    run,
    reload,
    setError,
    setNotice,
  };
}
