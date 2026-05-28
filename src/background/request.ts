/**
 * Fetches a URL and decodes the body using the charset advertised in its `content-type` header
 * (falling back to UTF-8). Shared by the settings storage (snippet loading), the `request` message
 * handler, and the Gist closure, so it lives in its own module rather than inside any one concern.
 *
 * @param url - The URL to fetch.
 * @param onReady - Called with the decoded body on success.
 * @param headers - Optional request headers.
 * @param data - Optional request body; its presence switches the method to POST.
 * @param onException - Optional handler for fetch/decode failures.
 */
export function request(
  url: string,
  onReady: (content: string) => void,
  headers?: any,
  data?: any,
  onException?: (exp: any) => void,
): void {
  headers = headers || {};
  const CHARTSET_RE = /(?:charset|encoding)\s*=\s*['"]? *([\w-]+)/i;

  fetch(url, {
    method: data !== undefined ? "POST" : "GET",
    headers,
    body: data,
  })
    .then((res) => {
      const cs = res.headers.get("content-type")
        ? res.headers.get("content-type")!.match(CHARTSET_RE)
        : [];

      return Promise.all([
        Promise.resolve(cs && cs.length > 1 ? cs[1] : "utf-8"),
        res.arrayBuffer(),
      ]);
    })
    .then((res) => {
      const decoder = new TextDecoder(res[0] as string);
      const content = decoder.decode(res[1] as ArrayBuffer);
      onReady(content);
    })
    .catch((exp) => {
      onException && onException(exp);
    });
}
