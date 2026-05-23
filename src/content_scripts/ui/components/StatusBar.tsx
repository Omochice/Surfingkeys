import { Show } from "solid-js";
import type { Component } from "solid-js";

export interface StatusBarProps {
    /** Status/mode text to display; the bar hides itself when empty. */
    text: string;
}

/**
 * Status line shown in the frontend iframe. A reactive Solid replacement for
 * the imperative `showStatus` DOM updates in the legacy frontend, wired into
 * the app at the WXT/Vite build cut-over.
 */
export const StatusBar: Component<StatusBarProps> = (props) => {
    return (
        <Show when={props.text}>
            <div class="sk_status_text">{props.text}</div>
        </Show>
    );
};
