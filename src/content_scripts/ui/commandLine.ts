/**
 * Parse an omnibar command line into tokens, treating a double-quoted span as a single token and
 * dropping the quote characters themselves. Lives in its own module because the tokeniser is a pure
 * concern independent of the omnibar's DOM/state, shared by the Commands handler and its tests.
 *
 * Each unquoted space is its own token separator, so two consecutive spaces emit an empty-string
 * token between them: `parseCommandLine("a" + " ".repeat(2) + "b")` returns `["a", "", "b"]`. The
 * input is trimmed first, so both an empty string and a whitespace-only string return `[""]` (a
 * single empty token) — callers cannot distinguish the two. This is the existing contract pinned by
 * commandLine.test.ts; callers must tolerate empty tokens.
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
