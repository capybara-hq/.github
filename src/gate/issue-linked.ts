import { isAccepted } from "./claim.ts";
import { closingRefs } from "./refs.ts";

export type IssueState = {
  number: number;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
};

export type Author = {
  login: string;
  type: "User" | "Bot";
  /** `unknown` means the permission lookup failed. */
  permission: "admin" | "maintain" | "write" | "triage" | "read" | "none" | "unknown";
};

export const EXEMPT_BOTS = ["github-actions[bot]", "dependabot[bot]", "renovate[bot]"];

const MAX_DESCRIPTION = 140;

function clip(text: string): string {
  return text.length <= MAX_DESCRIPTION ? text : `${text.slice(0, MAX_DESCRIPTION - 3)}...`;
}

const success = (description: string) => ({
  state: "success" as const,
  description: clip(description),
  comment: null,
});

/** The reason an issue does not qualify for `author`, or null when it does. */
function problem(number: number, issue: IssueState | null | undefined, login: string): string | null {
  if (!issue) return `#${number} not found in this repository`;
  if (issue.state === "closed") return `#${number} is closed`;
  if (!isAccepted(issue.labels)) return `#${number} is not accepted yet`;
  const me = login.toLowerCase();
  const others = issue.assignees.filter((a) => a.toLowerCase() !== me);
  if (others.length > 0 && !issue.assignees.some((a) => a.toLowerCase() === me)) {
    return `#${number} is assigned to ${others.map((a) => `@${a}`).join(", ")}`;
  }
  return null;
}

export function decideIssueLinked(input: {
  author: Author;
  body: string;
  repo: string;
  issues: Map<number, IssueState | null>;
}): { state: "success" | "failure"; description: string; comment: string | null } {
  const { author, body, repo, issues } = input;

  if (["admin", "maintain", "write"].includes(author.permission)) {
    return success("Exempt: has write access");
  }
  if (author.type === "Bot" && EXEMPT_BOTS.includes(author.login)) {
    return success("Exempt: trusted bot");
  }
  if (author.permission === "unknown") {
    return {
      state: "failure",
      description: "Could not read the author's permission. Re-run this check in a few minutes.",
      comment: null,
    };
  }

  const refs = closingRefs(body, repo);
  if (refs.length === 0) {
    return {
      state: "failure",
      description: "Link an accepted issue: add `Closes #<number>` to the description.",
      comment:
        "This repository requires every pull request from outside the team to close an accepted " +
        "issue. Add `Closes #<number>` to the description. If there is no accepted issue yet, " +
        "open one and wait for a maintainer to accept it; once it is accepted, comment `/claim` " +
        "on it to be assigned.",
    };
  }

  const problems: string[] = [];
  for (const n of refs) {
    const p = problem(n, issues.get(n), author.login);
    if (p === null) return success(`Linked to accepted issue #${n}`);
    problems.push(p);
  }
  return {
    state: "failure",
    description: clip(`${problems.join("; ")}. Link an accepted, unassigned issue.`),
    comment:
      "None of the linked issues can be used for this pull request:\n\n" +
      `${problems.map((p) => `- ${p}`).join("\n")}\n\n` +
      "Link an open issue that has the `accepted`, `good first issue` or `help wanted` label and " +
      "is unassigned or assigned to you. Comment `/claim` on an accepted issue to be assigned.",
  };
}
