import { FORM_SECTIONS } from "./forms.ts";

function sections(body: string): Map<string, string> {
  const result = new Map<string, string>();
  const parts = body.split(/^###[ \t]+/m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf("\n");
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
    const content = newline === -1 ? "" : part.slice(newline + 1).trim();
    result.set(heading.toLowerCase(), content);
  }
  return result;
}

function filled(content: string | undefined): boolean {
  return content !== undefined && content !== "" && content.toLowerCase() !== "_no response_";
}

/**
 * Ok when every required section of at least one form is present and non-empty.
 * `missing` lists the required labels missing from the closest form (fewest missing).
 */
export function checkIssueFormat(body: string): { ok: boolean; missing: string[] } {
  const found = sections(body);
  let best: string[] | null = null;
  for (const form of Object.values(FORM_SECTIONS)) {
    const missing = form
      .filter((s) => s.required && !filled(found.get(s.label.toLowerCase())))
      .map((s) => s.label);
    if (best === null || missing.length < best.length) best = missing;
  }
  const missing = best ?? [];
  return { ok: missing.length === 0, missing };
}
