import { start } from "./content.js";
// The help page's own logic self-runs on import (it queries top sites and
// fills the page). Importing it also installs the HTMLElement prototype
// helpers it relies on, via the shared utils module.
import "./start.js";

// Run the content-script mode system too, mirroring the old build that loaded
// content.js onto the help page so Surfingkeys keys work there.
start({});
