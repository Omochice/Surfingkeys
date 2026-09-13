/**
 * Parse an omnibar command line into tokens, treating a double-quoted span as a single token and
 * dropping the quote characters themselves.
 *
 * Each unquoted space is its own separator, so two consecutive spaces emit an empty-string token
 * between them, and the trimmed input makes both `""` and a whitespace-only string return `[""]`.
 * Callers must tolerate empty tokens.
 */
export function parseCommandLine(cmdline: string): string[] {
  cmdline = cmdline.trim();
  const tokens: string[] = [];
  let pendingToken = false;
  let part = "";
  for (let i = 0; i < cmdline.length; i++) {
    if (cmdline.charAt(i) === " " && !pendingToken) {
      tokens.push(part);
      part = "";
    } else {
      if (cmdline.charAt(i) === '"') {
        pendingToken = !pendingToken;
      } else {
        part += cmdline.charAt(i);
      }
    }
  }
  tokens.push(part);
  return tokens;
}
