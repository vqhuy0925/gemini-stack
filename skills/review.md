---
name: review
version: 1.1.0
description: |
  PR review and full project audit for gemini-stack. In PR mode, analyzes diff
  against main. In full mode, scans the entire codebase for Gemini API misuse,
  LLM trust boundary violations, quota/cost risks, prompt safety issues,
  conditional side effects, and other structural problems.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - AskUserQuestion
---

# Review Workflow

You are running the `/review` workflow for **gemini-stack**. This workflow supports two modes:

- **PR mode** (default): Reviews only the diff against `main`. Fast, focused, used before shipping.
- **Full mode** (`/review --full`): Scans the entire codebase. Slower, comprehensive, used for audits or onboarding.

Detect the mode from the invocation argument. If no argument is given, use **PR mode**.

---

## AskUserQuestion Format

**ALWAYS follow this structure for every AskUserQuestion call:**

1. Context: project name (`gemini-stack`), current branch, mode (PR or Full), what we're working on (1-2 sentences)
2. The specific question or decision point
3. `RECOMMENDATION: Choose [X] because [one-line reason]`
4. Lettered options: `A) ... B) ... C) ...`

---

## Step 1: Determine Mode & Scope

### PR Mode (default)

1. Run `git branch --show-current` to get the current branch.
2. If on `main`, output: **"Nothing to review — you're on main or have no changes against main."** and stop.
3. Run `git fetch origin main --quiet && git diff origin/main --stat` to check if there's a diff. If no diff, output the same message and stop.
4. The **review scope** = `git diff origin/main` (committed + uncommitted changes against latest main).

### Full Mode (`/review --full`)

1. No branch check required — full mode works on any branch including `main`.
2. Collect the list of all source files to review:

```bash
# Get all tracked source files, excluding dependencies and build artifacts
git ls-files | grep -v -E "(node_modules|dist|build|\.min\.|coverage|\.lock$|package-lock\.json)" \
  | grep -E "\.(js|ts|jsx|tsx|json|env\.example|md)$"
```

3. The **review scope** = entire codebase (all files above).
4. Output upfront: `Full Project Review — scanning N files across the codebase.`

> **Warning to agent:** Full mode reads many files. Work through them systematically using Glob and Read. Do not try to hold the entire codebase in one prompt — process by directory/module, then aggregate findings.

---

## Step 2: Read the checklist

Read `checklist.md`.

**If the file cannot be read, STOP and report the error.** Do not proceed without the checklist.

---

## Step 3: Gather the review target

### PR Mode

```bash
git fetch origin main --quiet
git diff origin/main
```

Use this diff as the input for all checklist passes.

### Full Mode

Scan the codebase in logical groups. Process each group with Glob + Read before moving to the next:

1. **Gemini client & config files** — `src/**/gemini*.{js,ts}`, `config/**`, `.env.example`
2. **Prompt & generation files** — `src/**/*prompt*.{js,ts}`, `src/**/*generation*.{js,ts}`, `prompts/**`
3. **API handlers & routes** — `src/**/routes/**`, `src/**/handlers/**`, `src/**/controllers/**`
4. **Frontend & UI** — `src/**/components/**`, `src/**/*.{jsx,tsx}`
5. **Tests** — `tests/**`, `src/**/*.test.{js,ts}`, `src/**/*.spec.{js,ts}`
6. **Everything else** — remaining tracked source files

For each group: use `Glob` to list files, then `Read` each file, then apply the checklist. Accumulate findings across all groups before outputting results.

---

## Step 4: Two-pass review

Apply the checklist against the review target in two passes:

1. **Pass 1 (CRITICAL):** Gemini API Safety, Model & Quota Risks, LLM Output Trust Boundary, Enum & Value Completeness
2. **Pass 2 (INFORMATIONAL):** Conditional Side Effects, Magic Numbers & String Coupling, Dead Code & Consistency, Prompt Issues, Test Gaps, Frontend/UI

**Enum & Value Completeness always requires reading code outside the immediate target.** When a new model name, enum value, status, or type constant is found, Grep for all sibling values and Read every consumer to verify the new value is handled.

In **Full mode**, also apply these additional whole-project checks that are impractical in PR mode:

- **Orphaned prompt files** — prompt files in `prompts/` or `config/` that are never imported anywhere
- **Model string inventory** — list every unique Gemini model string found across the codebase; flag any deprecated ones and any inconsistency (same logical model referred to by different strings)
- **Missing `.env` documentation** — any `process.env.X` reference with no corresponding entry in `.env.example`
- **Test coverage gaps** — source files with no corresponding test file at all
- **Dependency audit** — check `package.json` for known-outdated or risky packages (e.g. pinned to a deprecated `@google/generative-ai` version)

Follow the output format specified in the checklist. Respect the suppressions.

---

## Step 5: Output findings

**Always output ALL findings** — both critical and informational. The user must see every issue.

Output header format:

- PR mode: `Pre-Landing Review: N issues (X critical, Y informational)`
- Full mode: `Full Project Review: N issues (X critical, Y informational) across N files`

- **If CRITICAL issues found:** For EACH critical issue use a separate AskUserQuestion with the problem (`file:line` + description), then `RECOMMENDATION: Choose A because [one-line reason]`, then options:
  - A) Fix it now
  - B) Acknowledge — skip for now
  - C) False positive — skip

  After all critical questions are answered, summarize choices. If the user chose A on any issue, apply the recommended fixes. In PR mode, commit fixes and tell the user to re-run `/ship`. In Full mode, apply fixes in place — no commit required unless the user asks.

- **If only non-critical issues found:** Output them. No further action needed.
- **If no issues found:** Output `Review complete: No issues found.`

---

## Step 5.5: TODOS cross-reference

Read `TODOS.md` in the repository root (if it exists).

**PR mode:** Cross-reference the diff against open TODOs:

- Does this PR close any open TODOs? If yes, note: "This PR addresses TODO: `<title>`"
- Does this PR create work that should become a TODO? Flag as informational.

**Full mode:** Cross-reference the entire codebase against open TODOs:

- Are there TODOs in the code (grep for `// TODO`, `// FIXME`, `// HACK`) that aren't tracked in TODOS.md? List them as informational findings.
- Are there items in TODOS.md that appear to already be implemented? Flag for the user to verify and close.

If `TODOS.md` doesn't exist, skip this step silently.

---

## Important Rules

- **PR mode:** Read the FULL diff before commenting. Do not flag issues already addressed in the diff.
- **Full mode:** Read each file fully before flagging. Do not flag issues that are clearly handled elsewhere in the codebase.
- **Read-only by default.** Only modify files if the user explicitly chooses "Fix it now" on a critical issue. Never commit, push, or create PRs unless in PR mode and the user chose to fix.
- **Be terse.** One line problem, one line fix. No preamble.
- **Only flag real problems.** Skip anything that's fine.
- **Full mode is an audit tool, not a style guide enforcer.** Do not flag formatting, naming conventions, or subjective structure choices.
