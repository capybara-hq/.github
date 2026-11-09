import type { Author, IssueState } from "./gate/issue-linked.ts";

export type PR = {
  number: number;
  body: string;
  state: "open" | "closed";
  headSha: string;
  author: { login: string; type: "User" | "Bot" };
};

export type Permission = Author["permission"];

export interface GitHub {
  getPR(repo: string, n: number): Promise<PR>;
  /** The PR, or null when the repository has no PR with that number. */
  findPR(repo: string, n: number): Promise<PR | null>;
  listOpenPRs(repo: string): AsyncIterable<PR>;
  getIssue(repo: string, n: number): Promise<IssueState | null>;
  getPermission(repo: string, login: string): Promise<Permission>;
  setStatus(
    repo: string,
    sha: string,
    status: { state: "success" | "failure"; description: string; context: "issue-linked" | "cla" },
  ): Promise<void>;
  /** Edits the comment carrying the marker, deletes it when `body` is null, creates it otherwise. */
  upsertComment(repo: string, n: number, marker: string, body: string | null): Promise<void>;
  /** Always adds a new comment (carrying the marker for identification only). */
  addComment(repo: string, n: number, marker: string, body: string): Promise<void>;
  addLabels(repo: string, n: number, labels: string[]): Promise<void>;
  removeLabel(repo: string, n: number, label: string): Promise<void>;
  /** Assigns the user; returns the issue's resulting assignee logins. */
  assign(repo: string, n: number, login: string): Promise<string[]>;
}

/** A PR commit's author as the CLA check sees it: the GitHub account when there is one. */
export type Committer = { name: string; id: number | null };
export type IssueComment = { id: number; body: string; login: string; userId: number; createdAt: string };

/** CLA calls. Separate from `GitHub` so the gate's test fakes stay small. */
export interface ClaApi {
  /** One entry per commit of the PR, in order (not deduplicated). */
  listCommitters(repo: string, n: number): Promise<Committer[]>;
  listComments(repo: string, n: number): Promise<IssueComment[]>;
  /** The comment carrying the marker, or null. */
  findMarkedComment(repo: string, n: number, marker: string): Promise<{ id: number; body: string } | null>;
  editComment(repo: string, id: number, body: string): Promise<void>;
  /** File text and blob SHA on a branch; null when the branch or the file does not exist. */
  getBranchFile(repo: string, branch: string, path: string): Promise<{ text: string; sha: string } | null>;
  /**
   * Writes the file on the branch (creating the branch as an orphan when it is missing). `sha` is
   * the blob the change is based on, null for a new file. Returns false when the file changed
   * since that read (the caller re-reads and retries).
   */
  putBranchFile(
    repo: string,
    branch: string,
    path: string,
    file: { text: string; sha: string | null; message: string },
  ): Promise<boolean>;
  lockIssue(repo: string, n: number): Promise<void>;
}

export type Label = { name: string; color: string; description: string };
export type Ruleset = { id?: number; name: string; [key: string]: unknown };
export type RecentStatus = { context: string; state: string; createdAt: string };

/** Repository-settings calls. Separate from `GitHub` so the gate's test fakes stay small. */
export interface SettingsApi {
  /** Every ruleset of the repository, each fetched by id (the list endpoint omits `rules`). */
  getRulesets(repo: string): Promise<Ruleset[]>;
  createRuleset(repo: string, ruleset: Ruleset): Promise<void>;
  updateRuleset(repo: string, id: number, ruleset: Ruleset): Promise<void>;
  deleteRuleset(repo: string, id: number): Promise<void>;
  getLabels(repo: string): Promise<Label[]>;
  /** Updates the label when it exists, creates it otherwise. */
  upsertLabel(repo: string, label: Label): Promise<void>;
  getTeamId(org: string, slug: string): Promise<number>;
  /** File text, or null when the file does not exist. */
  getFile(repo: string, path: string): Promise<string | null>;
  /** Text of every file directly under `.github/workflows`; empty when the directory is missing. */
  getWorkflows(repo: string): Promise<string[]>;
  getPrivateReporting(repo: string): Promise<boolean>;
  enablePrivateReporting(repo: string): Promise<void>;
  /** Statuses with this context on the heads of PRs updated in the last 30 days (stops at the first match). */
  listRecentStatuses(repo: string, context: string): Promise<RecentStatus[]>;
}

export const markerOf = (name: string) => `<!-- capybara-gate:${name} -->`;

type RawPR = {
  number: number;
  body?: string | null;
  state: "open" | "closed";
  head: { sha: string };
  user: { login: string; type: string };
};

const toPR = (raw: RawPR): PR => ({
  number: raw.number,
  body: raw.body ?? "",
  state: raw.state,
  headSha: raw.head.sha,
  author: { login: raw.user.login, type: raw.user.type === "Bot" ? "Bot" : "User" },
});

type GitUser = { login: string; databaseId: number } | null;
type CommitConnection = {
  nodes: {
    commit: {
      author: { name: string | null; user: GitUser } | null;
      committer: { name: string | null; user: GitUser } | null;
    };
  }[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};
type CommitsPage = {
  data?: { repository: { pullRequest: { commits: CommitConnection } } };
  errors?: { message: string }[];
};

const COMMITS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      commits(first: 100, after: $cursor) {
        nodes {
          commit {
            author { name user { login databaseId } }
            committer { name user { login databaseId } }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const KNOWN_PERMISSIONS = ["admin", "maintain", "write", "triage", "read", "none"];

export function createClient(opts: {
  token: string;
  fetch?: typeof fetch;
  apiUrl?: string;
}): GitHub & SettingsApi & ClaApi {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.apiUrl ?? "https://api.github.com";

  /** `path` is a path under the API root, or an absolute URL (pagination links). */
  async function raw(method: string, path: string, body?: unknown): Promise<Response> {
    const url = path.startsWith("http") ? path : `${base}${path}`;
    return doFetch(url, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${opts.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function fail(method: string, path: string, res: Response): Error {
    return new Error(`${method} ${path} failed with status ${res.status}`);
  }

  /** Returns the parsed body; statuses listed in `allow` return null instead of throwing. */
  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    allow: number[] = [],
  ): Promise<T | null> {
    const res = await raw(method, path, body);
    if (allow.includes(res.status)) return null;
    if (!res.ok) throw fail(method, path, res);
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }

  function nextLink(res: Response): string | null {
    for (const part of (res.headers.get("link") ?? "").split(",")) {
      const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
      if (m?.[1]) return m[1];
    }
    return null;
  }

  async function* paged<T>(path: string): AsyncGenerator<T> {
    let next: string | null = path;
    while (next) {
      const res: Response = await raw("GET", next);
      if (!res.ok) throw fail("GET", next, res);
      for (const item of (await res.json()) as T[]) yield item;
      next = nextLink(res);
    }
  }

  async function findMarked(repo: string, n: number, marker: string): Promise<{ id: number; body: string } | null> {
    const tag = markerOf(marker);
    for await (const c of paged<{ id: number; body?: string | null }>(
      `/repos/${repo}/issues/${n}/comments?per_page=100`,
    )) {
      if (c.body?.includes(tag)) return { id: c.id, body: c.body };
    }
    return null;
  }

  async function findComment(repo: string, n: number, marker: string): Promise<number | null> {
    return (await findMarked(repo, n, marker))?.id ?? null;
  }

  const decode = (f: { content?: string; encoding?: string }) =>
    f.encoding === "base64" ? Buffer.from(f.content ?? "", "base64").toString("utf8") : (f.content ?? "");

  const settings: SettingsApi = {
    async getRulesets(repo) {
      const list = (await call<{ id: number }[]>("GET", `/repos/${repo}/rulesets?per_page=100`)) ?? [];
      const full: Ruleset[] = [];
      for (const r of list) {
        const one = await call<Ruleset>("GET", `/repos/${repo}/rulesets/${r.id}`);
        if (one) full.push(one);
      }
      return full;
    },

    async createRuleset(repo, ruleset) {
      await call("POST", `/repos/${repo}/rulesets`, ruleset);
    },

    async updateRuleset(repo, id, ruleset) {
      await call("PUT", `/repos/${repo}/rulesets/${id}`, ruleset);
    },

    async deleteRuleset(repo, id) {
      await call("DELETE", `/repos/${repo}/rulesets/${id}`, undefined, [404]);
    },

    async getLabels(repo) {
      const out: Label[] = [];
      for await (const l of paged<{ name: string; color: string; description?: string | null }>(
        `/repos/${repo}/labels?per_page=100`,
      )) {
        out.push({ name: l.name, color: l.color, description: l.description ?? "" });
      }
      return out;
    },

    async upsertLabel(repo, label) {
      const updated = await call(
        "PATCH",
        `/repos/${repo}/labels/${encodeURIComponent(label.name)}`,
        { color: label.color, description: label.description },
        [404],
      );
      if (updated === null) {
        // 204 never happens here; null means the label does not exist yet.
        await call("POST", `/repos/${repo}/labels`, label);
      }
    },

    async getTeamId(org, slug) {
      const team = await call<{ id: number }>("GET", `/orgs/${org}/teams/${slug}`);
      return team!.id;
    },

    async getFile(repo, path) {
      const f = await call<{ content?: string; encoding?: string }>(
        "GET",
        `/repos/${repo}/contents/${path}`,
        undefined,
        [404],
      );
      return f ? decode(f) : null;
    },

    async getWorkflows(repo) {
      const dir = await call<{ type: string; path: string }[]>(
        "GET",
        `/repos/${repo}/contents/.github/workflows`,
        undefined,
        [404],
      );
      const out: string[] = [];
      for (const f of dir ?? []) {
        if (f.type !== "file") continue;
        const text = await settings.getFile(repo, f.path);
        if (text !== null) out.push(text);
      }
      return out;
    },

    async getPrivateReporting(repo) {
      const r = await call<{ enabled: boolean }>("GET", `/repos/${repo}/private-vulnerability-reporting`);
      return r?.enabled === true;
    },

    async enablePrivateReporting(repo) {
      await call("PUT", `/repos/${repo}/private-vulnerability-reporting`);
    },

    async listRecentStatuses(repo, context) {
      const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const prs =
        (await call<{ updated_at: string; head: { sha: string } }[]>(
          "GET",
          `/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100`,
        )) ?? [];
      for (const pr of prs) {
        if (Date.parse(pr.updated_at) < since) break;
        const statuses =
          (await call<{ context: string; state: string; created_at: string }[]>(
            "GET",
            `/repos/${repo}/commits/${pr.head.sha}/statuses`,
          )) ?? [];
        const hit = statuses.find((s) => s.context === context);
        if (hit) return [{ context: hit.context, state: hit.state, createdAt: hit.created_at }];
      }
      return [];
    },
  };

  const cla: ClaApi = {
    async listCommitters(repo, n) {
      const [owner, name] = repo.split("/");
      const out: Committer[] = [];
      let cursor: string | null = null;
      do {
        const res: CommitsPage | null = await call<CommitsPage>("POST", "/graphql", {
          query: COMMITS_QUERY,
          variables: { owner, name, number: n, cursor },
        });
        if (!res?.data || res.errors?.length) {
          throw new Error(`GraphQL commits of ${repo}#${n} failed: ${res?.errors?.[0]?.message ?? "no data"}`);
        }
        const commits: CommitConnection = res.data.repository.pullRequest.commits;
        for (const { commit } of commits.nodes) {
          // The GitHub account behind the author, else the committer, else the git author name.
          const user = commit.author?.user ?? commit.committer?.user ?? null;
          if (user) out.push({ name: user.login, id: user.databaseId });
          else out.push({ name: commit.author?.name ?? commit.committer?.name ?? "unknown", id: null });
        }
        cursor = commits.pageInfo.hasNextPage ? commits.pageInfo.endCursor : null;
      } while (cursor);
      return out;
    },

    async listComments(repo, n) {
      const out: IssueComment[] = [];
      for await (const c of paged<{
        id: number;
        body?: string | null;
        user: { login: string; id: number } | null;
        created_at: string;
      }>(`/repos/${repo}/issues/${n}/comments?per_page=100`)) {
        if (!c.user) continue;
        out.push({ id: c.id, body: c.body ?? "", login: c.user.login, userId: c.user.id, createdAt: c.created_at });
      }
      return out;
    },

    findMarkedComment: findMarked,

    async editComment(repo, id, body) {
      await call("PATCH", `/repos/${repo}/issues/comments/${id}`, { body });
    },

    async getBranchFile(repo, branch, path) {
      const f = await call<{ content?: string; encoding?: string; sha: string }>(
        "GET",
        `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
        undefined,
        [404],
      );
      return f ? { text: decode(f), sha: f.sha } : null;
    },

    async putBranchFile(repo, branch, path, file) {
      const content = Buffer.from(file.text, "utf8").toString("base64");
      const branchRef = await call("GET", `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, undefined, [404]);
      if (branchRef === null) {
        // An orphan commit holding only this file, so the branch shares no history with main.
        const blob = await call<{ sha: string }>("POST", `/repos/${repo}/git/blobs`, { content, encoding: "base64" });
        const tree = await call<{ sha: string }>("POST", `/repos/${repo}/git/trees`, {
          tree: [{ path, mode: "100644", type: "blob", sha: blob!.sha }],
        });
        const commit = await call<{ sha: string }>("POST", `/repos/${repo}/git/commits`, {
          message: file.message,
          tree: tree!.sha,
          parents: [],
        });
        // 422: another run created the branch meanwhile; the caller re-reads and retries.
        const ref = await call("POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit!.sha }, [422]);
        return ref !== null;
      }
      const res = await call(
        "PUT",
        `/repos/${repo}/contents/${path}`,
        { message: file.message, content, branch, ...(file.sha ? { sha: file.sha } : {}) },
        // 409: the blob SHA is stale; 422: the file was created by another run meanwhile.
        [409, 422],
      );
      return res !== null;
    },

    async lockIssue(repo, n) {
      await call("PUT", `/repos/${repo}/issues/${n}/lock`);
    },
  };

  return {
    ...settings,
    ...cla,
    async getPR(repo, n) {
      return toPR((await call<RawPR>("GET", `/repos/${repo}/pulls/${n}`))!);
    },

    async findPR(repo, n) {
      const raw = await call<RawPR>("GET", `/repos/${repo}/pulls/${n}`, undefined, [404]);
      return raw ? toPR(raw) : null;
    },

    async *listOpenPRs(repo) {
      for await (const p of paged<RawPR>(`/repos/${repo}/pulls?state=open&per_page=100`)) {
        yield toPR(p);
      }
    },

    async getIssue(repo, n) {
      const issue = await call<{
        number: number;
        state: "open" | "closed";
        labels: ({ name: string } | string)[];
        assignees?: { login: string }[];
        pull_request?: unknown;
      }>("GET", `/repos/${repo}/issues/${n}`, undefined, [404]);
      // The issues API also serves pull requests; a PR is not an issue to close.
      if (!issue || issue.pull_request) return null;
      return {
        number: issue.number,
        state: issue.state,
        labels: issue.labels.map((l) => (typeof l === "string" ? l : l.name)),
        assignees: (issue.assignees ?? []).map((a) => a.login),
      };
    },

    async getPermission(repo, login) {
      try {
        const path = `/repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`;
        const res = await raw("GET", path);
        // No access at all is a normal answer for a stranger, not a failed lookup.
        if (res.status === 404) return "none";
        if (!res.ok) return "unknown";
        const data = (await res.json()) as { permission?: string; role_name?: string };
        // `role_name` distinguishes maintain / triage, which `permission` folds into write / read.
        const level = [data.role_name, data.permission].find(
          (p) => p !== undefined && KNOWN_PERMISSIONS.includes(p),
        );
        return (level as Permission | undefined) ?? "unknown";
      } catch {
        return "unknown";
      }
    },

    async setStatus(repo, sha, status) {
      await call("POST", `/repos/${repo}/statuses/${sha}`, status);
    },

    async upsertComment(repo, n, marker, body) {
      const id = await findComment(repo, n, marker);
      if (body === null) {
        if (id !== null) await call("DELETE", `/repos/${repo}/issues/comments/${id}`, undefined, [404]);
        return;
      }
      const text = `${markerOf(marker)}\n${body}`;
      if (id !== null) await call("PATCH", `/repos/${repo}/issues/comments/${id}`, { body: text });
      else await call("POST", `/repos/${repo}/issues/${n}/comments`, { body: text });
    },

    async addComment(repo, n, marker, body) {
      await call("POST", `/repos/${repo}/issues/${n}/comments`, {
        body: `${markerOf(marker)}\n${body}`,
      });
    },

    async addLabels(repo, n, labels) {
      await call("POST", `/repos/${repo}/issues/${n}/labels`, { labels });
    },

    async removeLabel(repo, n, label) {
      await call("DELETE", `/repos/${repo}/issues/${n}/labels/${encodeURIComponent(label)}`, undefined, [404]);
    },

    async assign(repo, n, login) {
      const res = await call<{ assignees?: { login: string }[] }>(
        "POST",
        `/repos/${repo}/issues/${n}/assignees`,
        { assignees: [login] },
      );
      return (res?.assignees ?? []).map((a) => a.login);
    },
  };
}
