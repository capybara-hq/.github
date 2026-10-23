import type { Label, Ruleset } from "../github.ts";

export const TEAM_SLUG = "maintainers";
export const TEAM_MENTION = "@capybara-hq/maintainers";
export const GATE_WORKFLOW = "capybara-hq/.github/.github/workflows/gate.yml";
/** GitHub Actions, the app that posts `ci-ok` and `issue-linked`. */
const ACTIONS_INTEGRATION_ID = 15368;

export type Desired = {
  labels: Label[];
  rulesets: Ruleset[];
  codeownersMention: string;
  privateReporting: true;
};

const MERGE_METHODS = ["merge", "squash", "rebase"];

const pullRequest = (extra: Record<string, boolean | number>) => ({
  type: "pull_request",
  parameters: {
    required_approving_review_count: 0,
    require_code_owner_review: false,
    require_last_push_approval: false,
    dismiss_stale_reviews_on_push: false,
    required_review_thread_resolution: false,
    allowed_merge_methods: MERGE_METHODS,
    ...extra,
  },
});

export function desired(teamId: number): Desired {
  const bypass = [{ actor_type: "Team", actor_id: teamId, bypass_mode: "pull_request" }];
  const base = {
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] as string[] } },
  };
  return {
    labels: [
      { name: "needs-triage", color: "fbca04", description: "Waiting for a maintainer to look at it" },
      { name: "needs-info", color: "d93f0b", description: "Waiting for more information from the author" },
      { name: "accepted", color: "0e8a16", description: "Accepted: ready for a contributor to take" },
      { name: "good first issue", color: "7057ff", description: "Accepted and suited to a first contribution" },
      { name: "help wanted", color: "008672", description: "Accepted and open to community contributors" },
    ],
    rulesets: [
      {
        ...base,
        name: "main-quality",
        bypass_actors: [],
        rules: [
          { type: "deletion" },
          { type: "non_fast_forward" },
          pullRequest({}),
          {
            type: "required_status_checks",
            parameters: {
              strict_required_status_checks_policy: true,
              required_status_checks: [
                { context: "ci-ok", integration_id: ACTIONS_INTEGRATION_ID },
                { context: "issue-linked", integration_id: ACTIONS_INTEGRATION_ID },
              ],
            },
          },
        ],
      },
      {
        ...base,
        name: "main-review",
        bypass_actors: bypass,
        rules: [
          pullRequest({
            required_approving_review_count: 1,
            require_code_owner_review: true,
            require_last_push_approval: true,
            dismiss_stale_reviews_on_push: true,
          }),
        ],
      },
      {
        ...base,
        name: "main-merge",
        bypass_actors: bypass,
        rules: [{ type: "update" }],
      },
    ],
    codeownersMention: TEAM_MENTION,
    privateReporting: true,
  };
}
