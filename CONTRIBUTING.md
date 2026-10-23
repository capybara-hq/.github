# Contributing to Capybara

Thanks for helping. This guide is the same for every repository in the `capybara-hq` organization.
A repository may add its own `CONTRIBUTING.md` for specifics; it links back here.

## Two kinds of contributors, one flow

| | Core developer | Community contributor |
|---|---|---|
| Who | Member of the `capybara-hq` org with write access | Anyone with a GitHub account |
| Pushes to | branches in `capybara-hq/<repo>` (`origin`) | branches in your fork (`origin`); `capybara-hq/<repo>` is `upstream` |
| Starts from | anything (an issue is optional) | an issue labeled `accepted` and assigned to you |
| Base for new branches and diffs | `origin/main` | `upstream/main` |
| CI on your PR | runs immediately | GitHub's "approve and run" for first-time contributors |
| Merge | a maintainer approves and merges | same |

Everything else is the same: a worktree per task, a design doc first for larger changes (reviewed
by a maintainer), Conventional Commits, changesets, `pnpm verify` before pushing, a PR using the
template, review, changes, and merge by a maintainer.

## From issue to merged PR

External PRs are not merged until the CLA bot is live; see each repository's CONTRIBUTING.md.

1. Open an issue with one of the forms (bug or feature). It starts as `needs-triage`.
2. A maintainer looks at it. If the form is incomplete the issue gets `needs-info`; fill in the
   missing sections. Rejected issues are closed as "not planned" with a one-line reason.
3. When a maintainer wants it done, it is labeled `accepted`. Issues labeled `good first issue` or
   `help wanted` are accepted and open to the community.
4. Comment `/claim` on an accepted issue. If it is unassigned it is assigned to you; otherwise the
   reply tells you who has it. One person works on an accepted issue.
5. Open a PR whose body contains `Closes #N` (or `Fixes #N` / `Resolves #N`) for that issue.
   The required status `issue-linked` passes when the issue is open, accepted, and unassigned or
   assigned to you.

There are no exemptions for small PRs: typo and docs fixes also need an accepted issue.
People with write access (core developers and maintainers) and the allowlisted bots
(`github-actions[bot]`, `dependabot[bot]`, `renovate[bot]`) do not need a linked issue.

## Who merges

Only maintainers (`@capybara-hq/maintainers`) can merge into `main`. A PR needs the required
statuses `ci-ok` and `issue-linked`, a branch up to date with `main`, and an approving review from
a code owner of the latest push. If you push after an approval, it needs a new one.

## Local commands

Every repository provides two `pnpm` scripts:

- `pnpm doctor:env` checks your environment (tool versions, dependencies, remotes, git identity).
  `pnpm doctor:env --fix` performs only fixes that need no decision.
- `pnpm verify` is the local equivalent of the required checks for your branch. Run it before
  pushing. Both accept `--json` for machine-readable output.

## Agents are optional

You can do all of this by hand. If you use a coding agent, the repositories ship shared skills
(`onboarding`, `contributing`, `reviewing-prs`) in `.agents/skills/`; Claude Code reads them through
the `.claude/skills` symlink. Their source is
[`capybara-hq/.github`](https://github.com/capybara-hq/.github/tree/main/skills). Do not edit the
copies in a repository; change the source and sync.

Each repository has an `AGENTS.md` describing its layout and rules, for example
[`core`'s AGENTS.md](https://github.com/capybara-hq/core/blob/main/AGENTS.md).

## Supported agents

Tier 1 agents are Claude Code, Codex, Cursor and GitHub Copilot; others are best effort. Smoke test
results (date, version) are recorded here.

| Agent | Version | Date | Result |
|---|---|---|---|
| _to be filled_ | | | |

## Code of conduct and security

Be kind: see the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities as described in
[SECURITY.md](SECURITY.md), never in a public issue.
