import type { Committer, IssueComment } from "../github.ts";

/** GitHub's id of github-actions[bot]: its commits never need a signature. */
const ACTIONS_BOT_ID = 41898282;
const ACTIONS_BOT = "github-actions[bot]";

export const DEFAULT_SIGN_PHRASE = "I have read the CLA Document and I hereby sign the CLA";
export const RECHECK = "recheck";

/** One record of `signatures/v1/cla.json` (the format the contributor-assistant action wrote). */
export type Signature = {
  name: string;
  id: number;
  comment_id: number;
  created_at: string;
  repoId: number;
  pullRequestNo: number;
};
export type SignatureFile = { signedContributors: Signature[] };

/** `*` matches any run of characters; anything else must match the whole name. */
export function isAllowlisted(name: string, allowlist: string): boolean {
  return allowlist
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .some((pattern) => {
      if (!pattern.includes("*")) return pattern === name;
      const source = pattern
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
      return new RegExp(`^${source}$`).test(name);
    });
}

/** Distinct committers by name, without github-actions[bot] and allowlisted names. */
export function committersToCheck(commits: Committer[], allowlist: string): Committer[] {
  const seen = new Set<string>();
  const out: Committer[] = [];
  for (const c of commits) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    if (c.id === ACTIONS_BOT_ID || isAllowlisted(c.name, allowlist)) continue;
    out.push(c);
  }
  return out;
}

export const isSignComment = (comment: IssueComment, phrase: string) =>
  comment.login !== ACTIONS_BOT && comment.body.trim().toLowerCase() === phrase.trim().toLowerCase();

export type ClaDecision = {
  signed: Committer[];
  notSigned: Committer[];
  /** Committers without a GitHub account: they cannot sign until the commit email is linked. */
  unknown: Committer[];
  /** Signatures to append to the file: committers who signed by comment on this PR just now. */
  newSignatures: Signature[];
};

export function decideCla(input: {
  committers: Committer[];
  file: SignatureFile;
  comments: IssueComment[];
  phrase: string;
  repoId: number;
  pr: number;
}): ClaDecision {
  const onFile = new Set(input.file.signedContributors.map((s) => s.id));
  const newSignatures: Signature[] = [];
  const signed: Committer[] = [];
  const notSigned: Committer[] = [];
  const unknown: Committer[] = [];
  for (const c of input.committers) {
    if (c.id === null) {
      unknown.push(c);
      notSigned.push(c);
      continue;
    }
    if (onFile.has(c.id)) {
      signed.push(c);
      continue;
    }
    const comment = input.comments.find((m) => m.userId === c.id && isSignComment(m, input.phrase));
    if (!comment) {
      notSigned.push(c);
      continue;
    }
    signed.push(c);
    newSignatures.push({
      name: comment.login,
      id: comment.userId,
      comment_id: comment.id,
      created_at: comment.createdAt,
      repoId: input.repoId,
      pullRequestNo: input.pr,
    });
  }
  return { signed, notSigned, unknown, newSignatures };
}

/** The bot comment: instructions while someone has not signed, a short note once all have. */
export function claComment(d: ClaDecision, opts: { documentUrl: string; phrase: string }): string {
  if (d.notSigned.length === 0) return "All contributors have signed the CLA. ✍️ ✅";
  const total = d.signed.length + d.notSigned.length;
  const you = total > 1 ? "you all" : "you";
  const lines = [
    `Thank you for your submission, we really appreciate it. Like many open-source projects, we ask that ${you} ` +
      `sign our [Contributor License Agreement](${opts.documentUrl}) before we can accept your contribution. ` +
      "You can sign the CLA by posting a comment on this pull request with exactly this text:",
    "",
    "```",
    opts.phrase,
    "```",
    "",
  ];
  if (total > 1) {
    lines.push(`**${d.signed.length}** out of **${total}** committers have signed the CLA.`);
    for (const c of d.signed) lines.push(`- :white_check_mark: @${c.name}`);
    for (const c of d.notSigned) lines.push(c.id === null ? `- :x: ${c.name}` : `- :x: @${c.name}`);
    lines.push("");
  }
  if (d.unknown.length > 0) {
    const names = d.unknown.map((c) => `**${c.name}**`).join(", ");
    lines.push(
      `${names} ${d.unknown.length > 1 ? "seem" : "seems"} not to be a GitHub user. You need a GitHub account to sign ` +
        "the CLA. If you already have one, [add the email address used for the commit to your account]" +
        "(https://docs.github.com/en/pull-requests/committing-changes-to-your-project/troubleshooting-commits/why-are-my-commits-linked-to-the-wrong-user).",
      "",
    );
  }
  lines.push(`<sub>Comment **${RECHECK}** on this pull request to run the check again.</sub>`);
  return lines.join("\n");
}

const MAX_DESCRIPTION = 140;

export function claStatus(d: ClaDecision): { state: "success" | "failure"; description: string } {
  if (d.notSigned.length === 0) return { state: "success", description: "All contributors have signed the CLA" };
  const names = d.notSigned.map((c) => c.name).join(", ");
  const text = `Not signed yet: ${names}`;
  return {
    state: "failure",
    description: text.length <= MAX_DESCRIPTION ? text : `${text.slice(0, MAX_DESCRIPTION - 3)}...`,
  };
}
