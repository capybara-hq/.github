import type { IssueState } from "./issue-linked.ts";

/** Labels that mark an issue as accepted for outside contributors. */
export const ACCEPTED_LABELS = ["accepted", "good first issue", "help wanted"];

export function isAccepted(labels: string[]): boolean {
  return labels.some((label) => ACCEPTED_LABELS.includes(label));
}

/** A comment claims an issue only when its first line, trimmed, is exactly `/claim`. */
export function parseClaim(body: string): boolean {
  return (body.split(/\r?\n/, 1)[0] ?? "").trim() === "/claim";
}

export function decideClaim(input: { commenter: string; issue: IssueState }): {
  action: "assign" | "reply";
  message: string;
} {
  const { commenter, issue } = input;
  if (issue.state === "closed") {
    return { action: "reply", message: "This issue is closed, so it can't be claimed." };
  }
  if (!isAccepted(issue.labels)) {
    return {
      action: "reply",
      message:
        "This issue is not accepted yet, so it cannot be claimed. " +
        "A maintainer adds the `accepted` label once it is ready for contributors.",
    };
  }
  const me = commenter.toLowerCase();
  if (issue.assignees.some((a) => a.toLowerCase() === me)) {
    return { action: "reply", message: "This issue is already assigned to you." };
  }
  if (issue.assignees.length > 0) {
    const names = issue.assignees.map((a) => `@${a}`).join(", ");
    return {
      action: "reply",
      message: `This issue is already assigned to ${names}. Pick another accepted issue, or ask in this thread.`,
    };
  }
  return { action: "assign", message: `Assigned to @${commenter}. Open a PR with \`Closes #${issue.number}\` when ready.` };
}
