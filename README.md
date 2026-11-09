# capybara-hq/.github

Org-wide community health files, reusable GitHub Actions workflows, shared agent skills and small Node scripts for capybara-hq repositories.
Consumers call the workflows at the moving tag `@v2`; releases are immutable `v2.x.y` tags (`v1`
stays where it was for old callers; its gate needs `pull_request_target`, which GitHub restricts).
See [profile/README.md](profile/README.md) for the organization profile.

A release (tag) happens only when a merged PR bumps `version` in package.json.

This repository's own `main` is protected like the others: PRs need `ci-ok`, `issue-linked` and a maintainer approval.

## Issue gate and CLA

`gate.yml` sets the required status `issue-linked` on PR heads (and handles issue forms and
`/claim`); `cla.yml` sets the status `cla`, comments the signing instructions and records
signatures. Neither uses `pull_request_target`. A calling repository has three workflow files:

```
pull_request (opened, edited, synchronize, reopened, closed)
  -> pr-event.yml  (no permissions, no secrets; uploads artifact `pr-event` with file `number`)
       |
       | workflow_run: completed (runs the default branch's files with a write token)
       v
  community.yml -> gate.yml@v2   pr job: download artifact, validate (src/pr-event.ts)
  cla.yml       -> cla.yml@v2    gate / cla job: read the PR again by number through the API
issues, issue_comment -> community.yml (re-evaluate PRs closing the issue; /claim)
issue_comment (signing sentence, `recheck`) -> cla.yml
```

- **Never trust the run.** `pr-event` runs the PR's own copy of `pr-event.yml`, so its artifact can
  hold anything. `src/pr-event.ts` accepts it only when the run was a successful `pull_request`
  run, the file holds a plain integer, that number is a PR of the repository and the PR's head SHA
  equals `workflow_run.head_sha`. The privileged jobs check out only this repository's tools, never
  the PR, and pass data to scripts through environment variables, never into `run:` lines.
- **Names are the contract**: the workflow name `pr-event`, the artifact `pr-event` and its file
  `number`. Copy `pr-event.yml` and `community.yml` from this repository; `cla.yml` callers pass
  `document-url` and `allowlist` (see core's `.github/workflows/cla.yml`). Grant the caller jobs
  `actions: read` (artifact download) besides the write scopes.
- **`workflow_run` only fires for the workflow file on the default branch**, so a change to the
  listeners takes effect once merged; `pr-event.yml` itself runs from each PR.
- **First-time contributors**: their `pull_request` runs wait for a maintainer's "Approve and run",
  so `issue-linked` and `cla` appear only after that approval.
