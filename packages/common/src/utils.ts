function regexFromString(str: string, caseSensitive?: boolean, highlight?: boolean): RegExp {
  let regex: RegExp;
  const flags = caseSensitive ? "" : "i";
  str = str.replaceAll(/[|\\{}()[\]^$+*?.]/g, String.raw`\$&`);
  if (highlight) {
    regex = new RegExp(str.replace(/\s+/, "|"), flags);
  } else {
    const words = str
      .split(/\s+/)
      .map((w) => {
        return `(?=.*${w})`;
      })
      .join("");
    regex = new RegExp(`^${words}.*$`, flags);
  }
  return regex;
}

function filterByTitleOrUrl<T extends { title?: string | undefined; url?: string | undefined }>(
  urls: readonly T[],
  query?: string,
  caseSensitive?: boolean,
): readonly T[] {
  if (query && query.length) {
    const regex = regexFromString(query, caseSensitive, false);
    return urls.filter((b) => {
      return regex.test(b.title ?? "") || regex.test(b.url ?? "");
    });
  }
  return urls;
}

export { filterByTitleOrUrl, regexFromString };
