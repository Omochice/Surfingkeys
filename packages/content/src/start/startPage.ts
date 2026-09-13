import { start } from "../content";
// Side-effect import: the help page's own logic self-runs, and it installs the HTMLElement
// prototype helpers it relies on via the shared utils module.
import "./start.js";

start({});
