export type FormSection = { label: string; required: boolean };

/**
 * The sections of each issue form. The YAML forms in `.github/ISSUE_TEMPLATE/` and the
 * issue format check both follow this list; `src/templates.test.ts` keeps the YAML in sync.
 */
export const FORM_SECTIONS: Record<"bug" | "feature", FormSection[]> = {
  bug: [
    { label: "What happened", required: true },
    { label: "Steps to reproduce", required: true },
    { label: "Expected behavior", required: true },
    { label: "Version or commit", required: true },
    { label: "Environment", required: false },
  ],
  feature: [
    { label: "Problem", required: true },
    { label: "Proposed solution", required: true },
    { label: "Alternatives considered", required: false },
  ],
};
