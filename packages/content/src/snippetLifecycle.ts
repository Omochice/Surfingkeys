import { LOG } from "@sk/adapter/log";

/** A point of the settings-snippet lifecycle that the content side can observe. */
type SnippetLifecycleMilestone =
  | "settingsReceived"
  | "settingsFetchFailed"
  | "runUserScriptRequested"
  | "userScriptReadyReceived"
  | "userSettingsApplied";

/**
 * Emit one settings-snippet lifecycle record, tagged with the frame it comes from.
 *
 * The frame tags are written last so a detail of the same name cannot displace them; the user
 * script runs in every frame, and a record that does not say which one is unattributable.
 */
function logSnippetLifecycle(
  milestone: SnippetLifecycleMilestone,
  details: Record<string, unknown>,
): void {
  LOG("log", "snippet-lifecycle", milestone, {
    ...details,
    top: window === top,
    href: window.location.href,
  });
}

export { logSnippetLifecycle };
