import type { Component } from "solid-js";
import DOMPurify from "dompurify";

export interface KeystrokeProps {
    /**
     * Raw HTML for the keystroke hint: the accumulated decoded keys while a
     * chord is being typed, or the annotated candidate list once rich hints
     * expand. Sanitized at the injection point as the legacy code did.
     */
    html: string;
    /** Whether the expanded rich-hint layout (annotations) is active. */
    rich: boolean;
}

/**
 * Keystroke hint shown at the bottom-right of the frontend iframe. The legacy
 * code set #sk_keystroke's innerHTML directly and toggled `expandRichHints` on
 * the container; here the class sits on the rendered child instead. The CSS
 * rules are descendant selectors, so the styling is unchanged, and the
 * controller in frontend.ts keeps owning the container's display, the chord
 * accumulation, and the rich-hint delay timer.
 */
export const Keystroke: Component<KeystrokeProps> = (props) => {
    return (
        <div
            classList={{ expandRichHints: props.rich }}
            innerHTML={DOMPurify.sanitize(props.html)}
        />
    );
};
