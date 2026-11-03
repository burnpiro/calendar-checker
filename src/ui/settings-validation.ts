import type { SyntheticEvent } from "react";

/** Native form validation must reveal invalid fields inside closed sections. */
export function revealInvalidSetting(event: SyntheticEvent<HTMLFormElement>) {
  if (!(event.target instanceof HTMLElement)) return;
  let parent = event.target.parentElement;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
}
