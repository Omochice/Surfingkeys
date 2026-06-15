function regexFromString(str: string, caseSensitive?: boolean, highlight?: boolean): RegExp {
  let rxp: RegExp;
  const flags = caseSensitive ? "" : "i";
  str = str.replaceAll(/[|\\{}()[\]^$+*?.]/g, String.raw`\$&`);
  if (highlight) {
    rxp = new RegExp(str.replace(/\s+/, "|"), flags);
  } else {
    const words = str
      .split(/\s+/)
      .map((w) => {
        return `(?=.*${w})`;
      })
      .join("");
    rxp = new RegExp(`^${words}.*$`, flags);
  }
  return rxp;
}

function filterByTitleOrUrl<T extends { title?: string | undefined; url?: string | undefined }>(
  urls: readonly T[],
  query?: string,
  caseSensitive?: boolean,
): readonly T[] {
  if (query && query.length) {
    const rxp = regexFromString(query, caseSensitive, false);
    return urls.filter((b) => {
      return rxp.test(b.title ?? "") || rxp.test(b.url ?? "");
    });
  }
  return urls;
}

export { filterByTitleOrUrl, regexFromString };
