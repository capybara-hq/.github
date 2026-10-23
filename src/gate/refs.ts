const KEYWORD = "(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)";
const REFERENCE = [
  "#(?<plain>\\d+)",
  "(?<qualified>[\\w.-]+/[\\w.-]+)#(?<qualifiedNumber>\\d+)",
  "https://github\\.com/(?<urlRepo>[\\w.-]+/[\\w.-]+)/issues/(?<urlNumber>\\d+)",
].join("|");
const CLOSING = new RegExp(`(?<![\\w])${KEYWORD}:?\\s+(?:${REFERENCE})(?!\\w)`, "gi");

/**
 * Issue numbers a PR body closes: a closing keyword followed by `#N`, `owner/name#N` or an
 * issue URL, where the repository is `repo`. Deduplicated, in order of appearance.
 */
export function closingRefs(body: string, repo: string): number[] {
  const wanted = repo.toLowerCase();
  const found: number[] = [];
  for (const match of body.matchAll(CLOSING)) {
    const g = match.groups ?? {};
    let number: string | undefined;
    if (g.plain) number = g.plain;
    else if (g.qualified && g.qualified.toLowerCase() === wanted) number = g.qualifiedNumber;
    else if (g.urlRepo && g.urlRepo.toLowerCase() === wanted) number = g.urlNumber;
    if (number === undefined) continue;
    const n = Number(number);
    if (!found.includes(n)) found.push(n);
  }
  return found;
}
