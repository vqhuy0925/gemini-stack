---
name: ship
version: 1.0.0
description: |
  Ship workflow for gemini-stack: merge main, run tests, review diff, bump VERSION,
  update CHANGELOG, commit, push, create PR.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
---

# Ship: Fully Automated Ship Workflow

You are running the `/ship` workflow for **gemini-stack**. This is a **non-interactive, fully automated** workflow. Do NOT ask for confirmation at any step. The user said `/ship` which means DO IT. Run straight through and output the PR URL at the end.

**Only stop for:**

- On `main` branch (abort)
- Merge conflicts that can't be auto-resolved (stop, show conflicts)
- Test failures (stop, show failures)
- Pre-landing review finds CRITICAL issues and user chooses to fix (not acknowledge or skip)
- MINOR or MAJOR version bump needed (ask — see Step 4)
- TODOS.md missing and user wants to create one (ask — see Step 5.5)
- TODOS.md disorganized and user wants to reorganize (ask — see Step 5.5)

**Never stop for:**

- Uncommitted changes (always include them)
- Version bump choice when MICRO or PATCH (auto-pick — see Step 4)
- CHANGELOG content (auto-generate from diff)
- Commit message approval (auto-commit)
- Multi-file changesets (auto-split into bisectable commits)
- TODOS.md completed-item detection (auto-mark)

---

## AskUserQuestion Format

**ALWAYS follow this structure for every AskUserQuestion call:**

1. Context: project name (`gemini-stack`), current branch, what we're working on (1-2 sentences)
2. The specific question or decision point
3. `RECOMMENDATION: Choose [X] because [one-line reason]`
4. Lettered options: `A) ... B) ... C) ...`

---

## Step 1: Pre-flight

1. Check the current branch. If on `main`, **abort**: "You're on main. Ship from a feature branch."

2. Run `git status`. Uncommitted changes are always included — no need to ask.

3. Run `git diff main...HEAD --stat` and `git log main..HEAD --oneline` to understand what's being shipped.

---

## Step 2: Merge origin/main (BEFORE tests)

Fetch and merge `origin/main` into the feature branch so tests run against the merged state:

```bash
git fetch origin main && git merge origin/main --no-edit
```

**If there are merge conflicts:** Try to auto-resolve if they are simple (VERSION, CHANGELOG ordering). If conflicts are complex or ambiguous, **STOP** and show them.

**If already up to date:** Continue silently.

---

## Step 3: Run tests (on merged code)

Run the project's test suite. Check `package.json` for the correct test script — common patterns for gemini-stack:

```bash
npm run test 2>&1 | tee /tmp/ship_tests.txt
```

If the project has multiple test suites (unit + integration), run them in parallel:

```bash
npm run test:unit 2>&1 | tee /tmp/ship_unit.txt &
npm run test:integration 2>&1 | tee /tmp/ship_integration.txt &
wait
```

After all complete, read the output files and check pass/fail.

**If any test fails:** Show the failures and **STOP**. Do not proceed.

**If all pass:** Continue silently — just note the counts briefly.

---

## Step 3.25: Gemini Prompt Evals (conditional)

Evals are mandatory when prompt-related files change. Skip this step entirely if no prompt files are in the diff.

**1. Check if the diff touches prompt-related files:**

```bash
git diff origin/main --name-only
```

Match against these patterns:

- `src/**/*prompt*.{js,ts}`
- `src/**/*system*.{js,ts}`
- `prompts/**/*`
- `config/models.{js,ts,json}`
- `src/**/*generation*.{js,ts}`
- `src/**/*evaluator*.{js,ts}`
- `tests/evals/**/*`

**If no matches:** Print "No prompt-related files changed — skipping evals." and continue to Step 3.5.

**2. Run affected eval suites:**

```bash
npm run eval 2>&1 | tee /tmp/ship_evals.txt
```

If the project has targeted eval runners, run only the suites matching changed files. If unsure which suites are affected, run all evals — over-testing is better than missing a regression.

**3. Check results:**

- **If any eval fails:** Show the failures and **STOP**. Do not proceed.
- **If all pass:** Note pass counts. Continue to Step 3.5.

**4. Save eval output** — include eval results in the PR body (Step 8).

---

## Step 3.5: Pre-Landing Review

Review the diff for structural issues that tests don't catch.

1. Read `/skills/checklist.md`. If the file cannot be read, **STOP** and report the error.

2. Run `git diff origin/main` to get the full diff.

3. Apply the review checklist in two passes:
   - **Pass 1 (CRITICAL):** Gemini API Safety, Model & Quota Risks, LLM Output Trust Boundary, Enum & Value Completeness
   - **Pass 2 (INFORMATIONAL):** All remaining categories

4. **Always output ALL findings** — both critical and informational.

5. Output a summary header: `Pre-Landing Review: N issues (X critical, Y informational)`

6. **If CRITICAL issues found:** For EACH critical issue, use a separate AskUserQuestion with:
   - The problem (`file:line` + description)
   - `RECOMMENDATION: Choose A because [one-line reason]`
   - Options: A) Fix it now, B) Acknowledge and ship anyway, C) It's a false positive — skip

   After resolving all critical issues: if the user chose A (fix) on any issue, apply the recommended fixes, then commit only the fixed files (`git add <fixed-files> && git commit -m "fix: apply pre-landing review fixes"`), then **STOP** and tell the user to run `/ship` again to re-test with the fixes applied. If the user chose only B or C on all issues, continue with Step 4.

7. **If only non-critical issues found:** Output them and continue. They will be included in the PR body at Step 8.

8. **If no issues found:** Output `Pre-Landing Review: No issues found.` and continue.

Save the review output — it goes into the PR body in Step 8.

---

## Step 4: Version bump (auto-decide)

1. Read the current `VERSION` file (format: `MAJOR.MINOR.PATCH`)

   If no `VERSION` file exists, check `package.json` for the `version` field and use that. If neither exists, create `VERSION` with `0.1.0`.

2. **Auto-decide the bump level based on the diff:**
   - Count lines changed: `git diff origin/main...HEAD --stat | tail -1`
   - **PATCH** (3rd digit): < 50 lines changed, trivial tweaks, typos, config, bug fixes
   - **MINOR** (2nd digit): 50+ lines changed, new features, API changes — **auto-pick, no need to ask**
   - **MAJOR** (1st digit): **ASK the user** — only for breaking changes or major milestones

3. Compute the new version:
   - Bumping a digit resets all digits to its right to 0
   - Example: `1.2.3` + MINOR → `1.3.0`

4. Write the new version to the `VERSION` file. If the project uses `package.json` for versioning, also update `package.json` with `npm version <new-version> --no-git-tag-version`.

---

## Step 5: CHANGELOG (auto-generate)

1. Read `CHANGELOG.md` header to know the format. If no CHANGELOG exists, create one following [Keep a Changelog](https://keepachangelog.com) format.

2. Auto-generate the entry from **ALL commits on the branch**:
   - Use `git log main..HEAD --oneline` to see every commit being shipped
   - Use `git diff main...HEAD` to see the full diff against main
   - The CHANGELOG entry must be comprehensive of ALL changes going into the PR
   - Categorize changes:
     - `### Added` — new features, new model support, new API endpoints
     - `### Changed` — changes to existing functionality, model upgrades, config changes
     - `### Fixed` — bug fixes, error handling improvements, quota handling fixes
     - `### Removed` — removed features, deprecated model cleanup
   - Insert after the file header, dated today
   - Format: `## [X.Y.Z] - YYYY-MM-DD`

**Do NOT ask the user to describe changes.** Infer from the diff and commit history.

---

## Step 5.5: TODOS.md (auto-update)

Cross-reference the project's TODOS.md against the changes being shipped. Mark completed items automatically; prompt only if the file is missing or disorganized.

**1. Check if TODOS.md exists** in the repository root.

**If TODOS.md does not exist:** Use AskUserQuestion:

- Message: "gemini-stack recommends maintaining a TODOS.md organized by component/feature, then priority (P0 at top through P4, then Completed at bottom). Would you like to create one?"
- Options: A) Create it now, B) Skip for now
- If A: Create `TODOS.md` with a skeleton (`# TODOS` heading + `## Completed` section). Continue to step 3.
- If B: Skip the rest of Step 5.5. Continue to Step 6.

**2. Check structure and organization:**

Read TODOS.md and verify:

- Items grouped under `## <Component/Feature>` headings
- Each item has a `**Priority:**` field (P0–P4)
- A `## Completed` section at the bottom

**If disorganized:** Use AskUserQuestion:

- Options: A) Reorganize now (recommended), B) Leave as-is
- If A: Reorganize in-place. Preserve all content — only restructure, never delete items.

**3. Detect completed TODOs** (fully automatic — no user interaction):

Use `git diff main...HEAD` and `git log main..HEAD --oneline` already gathered earlier.

For each TODO item, check if changes in this PR complete it. **Be conservative** — only mark as completed if there is clear evidence in the diff.

**4. Move completed items** to `## Completed`. Append: `**Completed:** vX.Y.Z (YYYY-MM-DD)`

**5. Output summary:**

- `TODOS.md: N items marked complete (item1, item2, ...). M items remaining.`
- Or: `TODOS.md: No completed items detected. M items remaining.`

**6. Defensive:** If TODOS.md cannot be written, warn and continue. Never stop the ship workflow for a TODOS failure.

Save this summary — it goes into the PR body in Step 8.

---

## Step 6: Commit (bisectable chunks)

**Goal:** Create small, logical commits that work well with `git bisect`.

1. Analyze the diff and group changes into logical commits. Each commit = one coherent change, not one file.

2. **Commit ordering** (earlier commits first):
   - **Config & infrastructure:** env config, model config, route/middleware changes
   - **Core logic:** Gemini client wrappers, prompt builders, generation services (with their tests)
   - **API handlers / controllers:** route handlers, request/response logic (with their tests)
   - **UI / frontend:** React components, views, streaming UI (with their tests)
   - **VERSION + CHANGELOG + TODOS.md:** always in the final commit

3. **Rules for splitting:**
   - A module and its test file go in the same commit
   - Config changes can group with the feature they enable
   - If the total diff is small (< 50 lines across < 4 files), a single commit is fine
   - Each commit must be independently valid — no broken imports, no dangling references

4. Compose commit messages:
   - First line: `<type>: <summary>` (type = feat/fix/chore/refactor/docs)
   - Body: brief description of what this commit contains
   - Only the **final commit** (VERSION + CHANGELOG) gets the version tag and co-author trailer:

```bash
git commit -m "$(cat <<'EOF'
chore: bump version and changelog (vX.Y.Z)

Co-Authored-By: Vu Quoc Huy <[huy.vuquoc.it@gmail.com]>
EOF
)"
```

---

## Step 7: Push

```bash
git push -u origin <branch-name>
```

---

## Step 8: Create PR

```bash
gh pr create --title "<type>: <summary>" --body "$(cat <<'EOF'
## Summary
<bullet points from CHANGELOG>

## Pre-Landing Review
<findings from Step 3.5, or "No issues found.">

## Eval Results
<If evals ran: suite names, pass/fail counts.>
<If skipped: "No prompt-related files changed — evals skipped.">

## TODOS
<If items marked complete: bullet list of completed items with version.>
<If no items completed: "No TODO items completed in this PR.">
<If TODOS.md created or reorganized: note that.>
<If TODOS.md doesn't exist and user skipped: omit this section.>

## Test plan
- [x] All tests pass (N tests, 0 failures)

    Generated with [Gemini]
EOF
)"
```

**Output the PR URL** — this should be the final output the user sees.

---

## Important Rules

- **Never skip tests.** If tests fail, stop.
- **Never skip the pre-landing review.** If checklist.md is unreadable, stop.
- **Never force push.** Use regular `git push` only.
- **Never ask for confirmation** except for MAJOR version bumps and CRITICAL review findings.
- **Date format in CHANGELOG:** `YYYY-MM-DD`
- **Split commits for bisectability** — each commit = one logical change.
- **TODOS.md completion detection must be conservative.** Only mark items as completed when the diff clearly shows the work is done.
- **The goal is: user says `/ship`, next thing they see is the review + PR URL.**
