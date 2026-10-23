import { readFileSync } from "node:fs";
import { createClient, type GitHub, type PR } from "../github.ts";
import { decideClaim, parseClaim } from "./claim.ts";
import { checkIssueFormat } from "./issue-format.ts";
import { type Author, decideIssueLinked, type IssueState } from "./issue-linked.ts";
import { closingRefs } from "./refs.ts";

type GateEvent = { name: string; payload: unknown; repo: string };

// Loose view of the webhook payload fields this gate reads.
type Payload = {
  action?: string;
  number?: number;
  issue?: {
    number: number;
    body?: string | null;
    user?: { login: string };
    labels?: ({ name: string } | string)[];
    pull_request?: unknown;
  };
  comment?: { body?: string | null; user?: { login: string } };
};

const WRITE_ACCESS = ["admin", "maintain", "write"];
const ISSUE_ACTIONS = ["labeled", "unlabeled", "assigned", "unassigned", "closed", "reopened"];

/** Sets the `issue-linked` status on the PR's head commit and syncs its gate comment. */
async function evaluatePR(
  gh: GitHub,
  repo: string,
  pr: PR,
  issueCache: Map<number, Promise<IssueState | null>>,
): Promise<void> {
  const author: Author = {
    login: pr.author.login,
    type: pr.author.type,
    permission: await gh.getPermission(repo, pr.author.login),
  };
  const issues = new Map<number, IssueState | null>();
  for (const n of closingRefs(pr.body, repo)) {
    let pending = issueCache.get(n);
    if (!pending) {
      pending = gh.getIssue(repo, n);
      issueCache.set(n, pending);
    }
    issues.set(n, await pending);
  }
  const decision = decideIssueLinked({ author, body: pr.body, repo, issues });
  await gh.setStatus(repo, pr.headSha, {
    state: decision.state,
    description: decision.description,
    context: "issue-linked",
  });
  await gh.upsertComment(repo, pr.number, "issue-linked", decision.comment);
}

async function checkFormat(gh: GitHub, repo: string, payload: Payload): Promise<void> {
  const issue = payload.issue;
  if (!issue?.user) return;
  const permission = await gh.getPermission(repo, issue.user.login);
  if (WRITE_ACCESS.includes(permission)) return;

  const result = checkIssueFormat(issue.body ?? "");
  const labels = (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
  if (!result.ok) {
    if (!labels.includes("needs-info")) await gh.addLabels(repo, issue.number, ["needs-info"]);
    await gh.upsertComment(
      repo,
      issue.number,
      "issue-format",
      "Thanks for the report. Please fill in the missing sections of the issue form so a " +
        `maintainer can triage it:\n\n${result.missing.map((m) => `- ${m}`).join("\n")}\n\n` +
        "Edit the issue description to add them; this comment updates automatically.",
    );
    return;
  }
  if (labels.includes("needs-info")) await gh.removeLabel(repo, issue.number, "needs-info");
  await gh.upsertComment(repo, issue.number, "issue-format", null);
}

async function claim(gh: GitHub, repo: string, payload: Payload): Promise<void> {
  const { issue, comment } = payload;
  if (!issue || issue.pull_request || !comment?.user || !parseClaim(comment.body ?? "")) return;
  const current = await gh.getIssue(repo, issue.number);
  if (!current) return;
  const decision = decideClaim({ commenter: comment.user.login, issue: current });
  if (decision.action === "assign") await gh.assign(repo, issue.number, comment.user.login);
  await gh.addComment(repo, issue.number, "claim", decision.message);
}

export async function runGate(event: GateEvent, gh: GitHub): Promise<void> {
  const payload = event.payload as Payload;
  const { repo } = event;
  const cache = new Map<number, Promise<IssueState | null>>();

  switch (event.name) {
    case "pull_request_target": {
      const number = payload.number;
      if (number === undefined) throw new Error("pull_request_target payload has no number");
      await evaluatePR(gh, repo, await gh.getPR(repo, number), cache);
      return;
    }
    case "issues": {
      if (!payload.issue) return;
      if (payload.action === "opened" || payload.action === "edited") {
        await checkFormat(gh, repo, payload);
      } else if (payload.action && ISSUE_ACTIONS.includes(payload.action)) {
        // Page through every open PR: any of them may close the changed issue.
        for await (const pr of gh.listOpenPRs(repo)) {
          if (closingRefs(pr.body, repo).includes(payload.issue.number)) {
            await evaluatePR(gh, repo, pr, cache);
          }
        }
      }
      return;
    }
    case "issue_comment":
      if (payload.action === "created") await claim(gh, repo, payload);
      return;
    default:
      return;
  }
}

if (import.meta.main) {
  const env = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  const payload: unknown = JSON.parse(readFileSync(env("GITHUB_EVENT_PATH"), "utf8"));
  const gh = createClient({ token: env("GITHUB_TOKEN") });
  await runGate({ name: env("GITHUB_EVENT_NAME"), payload, repo: env("GITHUB_REPOSITORY") }, gh);
}
