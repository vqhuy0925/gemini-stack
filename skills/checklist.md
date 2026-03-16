# Pre-Landing Review Checklist — gemini-stack

## Instructions

Review the `git diff origin/main` output for the issues listed below. Be specific — cite `file:line` and suggest fixes. Skip anything that's fine. Only flag real problems.

**Two-pass review:**

- **Pass 1 (CRITICAL):** Run Gemini API Safety, Model & Quota Risks, and LLM Output Trust Boundary first. These can block `/ship`.
- **Pass 2 (INFORMATIONAL):** Run all remaining categories. These are included in the PR body but do not block.

**Output format:**

```
Pre-Landing Review: N issues (X critical, Y informational)

**CRITICAL** (blocking /ship):
- [file:line] Problem description
  Fix: suggested fix

**Issues** (non-blocking):
- [file:line] Problem description
  Fix: suggested fix
```

If no issues found: `Pre-Landing Review: No issues found.`

Be terse. For each issue: one line describing the problem, one line with the fix. No preamble, no summaries, no "looks good overall."

---

## Review Categories

### Pass 1 — CRITICAL

#### Gemini API Safety

- **Hardcoded API keys** in source code, `.env` committed to repo, or keys logged to console/file — use environment variables and verify `.gitignore` covers `.env`
- **Deprecated model strings** used (e.g., `gemini-1.5-pro-latest`, `gemini-pro`) — replace with current stable names like `gemini-2.0-flash` or `gemini-3-flash`
- **No error handling on API calls** — Gemini throws `429`, `404`, `500`; every `generateContent` call must have try/catch with typed error handling
- **No retry logic for transient errors** — `429 Too Many Requests` requires exponential backoff; bare `fetch` or SDK calls with no retry are fragile in production
- **Streaming responses not properly terminated** — unclosed streams can leak resources; ensure `stream.return()` or equivalent is called on early exit

#### Model & Quota Risks

- **Free tier model used in production paths** — `gemini-2.0-flash` free tier has hard daily caps; production code should either use paid tier or have a circuit breaker
- **No model fallback defined** — if primary model (`gemini-3-flash`) fails or is unavailable, is there a fallback (e.g., `gemini-2.0-flash`)? No fallback = full outage on model deprecation
- **Model name hardcoded in multiple files** — if the model string appears in 3+ places, it should be a single config constant (e.g., `GEMINI_MODEL` in `config.js`)
- **`max_tokens` / `maxOutputTokens` not set** — unbounded output can exhaust quota unexpectedly; always set a reasonable ceiling
- **No cost guardrails on loops** — calling `generateContent` inside a loop without a max-iteration cap or token budget risks runaway API costs

#### LLM Output Trust Boundary

- **LLM-generated values written to DB without validation** — emails, URLs, names from Gemini responses must be validated (regex/schema) before persisting
- **Structured JSON output from Gemini parsed without schema check** — use `zod`, `joi`, or equivalent to validate shape before using fields
- **Raw LLM text injected into HTML/SQL/shell** — treat all model output as untrusted user input; sanitize before interpolation
- **`response.text()` used directly as executable code or eval input** — never `eval()` or `new Function()` on model output
- **Tool/function call results accepted without type checks** — Gemini function calling can return unexpected types; validate before DB writes

#### Enum & Value Completeness

When the diff introduces a new model name, status string, tier, or role constant:

- **Trace it through every consumer.** Read (don't just grep — READ) each file that switches on, filters by, or displays that value. If any consumer doesn't handle the new value, flag it.
- **Check allowlists/filter arrays.** Search for arrays or lists containing sibling values and verify the new value is included where needed.
- **Check `switch`/`if-else` chains.** If existing code branches on the enum, does the new value fall through to a wrong default?

To do this: use Grep to find all references to sibling values. Read each match. This step requires reading code OUTSIDE the diff.

---

### Pass 2 — INFORMATIONAL

#### Conditional Side Effects

- Code paths that branch on a condition but forget to apply a side effect on one branch (e.g., quota check passes but usage counter only incremented on one path)
- Log messages that claim an action happened but the action was conditionally skipped

#### Magic Numbers & String Coupling

- Bare numeric literals for token counts, temperature, top_p, retry delays used in multiple files — should be named constants
- Model name strings used as query filters or cache keys elsewhere (grep for the string — is anything matching on it?)

#### Dead Code & Consistency

- Variables assigned but never read
- Commented-out `console.log` or debug prompts left in
- CHANGELOG entries that describe changes inaccurately
- Comments/docstrings that describe old behavior after the code changed

#### Prompt Issues

- **0-indexed lists in prompts** — LLMs reliably return 1-indexed; use 1-based numbering in prompts
- **Prompt lists available tools/capabilities that don't match what's actually wired up** — stale capability lists in system prompts cause hallucinations
- **Temperature set to 0 for creative tasks or 1.0 for structured output tasks** — mismatch between temperature and task type
- **System prompt and user prompt contain contradictory instructions** — model will follow one and ignore the other unpredictably
- **`safetySettings` disabled globally** — disabling all safety filters for convenience is a trust boundary violation; only disable specific categories with justification

#### Test Gaps

- Negative-path tests that assert error type but not the side effects (quota counter incremented? fallback triggered? cache invalidated?)
- No mock for Gemini API in unit tests — tests that call the real API are flaky and incur quota costs
- `.toHaveBeenCalledTimes(0)` / `.never` missing when a code path should explicitly NOT call the API
- Rate limit / 429 handling not tested end-to-end

#### Crypto & Entropy

- `Math.random()` used for session tokens, nonces, or cache-busting keys — use `crypto.randomUUID()` or `crypto.getRandomValues()`
- Non-constant-time comparisons (`===`) on API keys or secrets — vulnerable to timing attacks

#### Time Window Safety

- Date-key cache lookups that assume "today" covers 24h — a response cached at 11:58pm is stale at 12:00am under a daily key
- Quota reset times assumed without checking Google's actual reset window (per-minute vs per-day vs per-month)

#### Type Coercion at Boundaries

- Values crossing JS→JSON→DB boundaries where type could change (numeric vs string in Gemini response fields)
- Cache keys built from unserialized objects — `{ model: "gemini-2.0-flash" }` vs `JSON.stringify(...)` produce different keys

#### Frontend/UI

- Raw Gemini markdown output rendered as plain text (should use a markdown renderer)
- Streaming token display that doesn't handle mid-stream errors gracefully (spinner stuck on API failure)
- No loading/disabled state on "Generate" buttons — double-submit can fire duplicate API calls

---

## Gate Classification

```
CRITICAL (blocks /ship):              INFORMATIONAL (in PR body):
├─ Gemini API Safety                  ├─ Conditional Side Effects
├─ Model & Quota Risks                ├─ Magic Numbers & String Coupling
├─ LLM Output Trust Boundary          ├─ Dead Code & Consistency
└─ Enum & Value Completeness          ├─ Prompt Issues
                                       ├─ Test Gaps
                                       ├─ Crypto & Entropy
                                       ├─ Time Window Safety
                                       ├─ Type Coercion at Boundaries
                                       └─ Frontend/UI
```

---

## Suppressions — DO NOT flag these

- "X is redundant with Y" when the redundancy is harmless and aids readability
- "Add a comment explaining why this temperature/threshold was chosen" — these are tuned empirically and change constantly
- "This assertion could be tighter" when the assertion already covers the behavior
- Suggesting consistency-only changes
- Model name appearing twice in the same file if one is a comment/doc and one is usage
- Eval threshold or scoring constant changes — these are tuned empirically
- Harmless no-ops
- ANYTHING already addressed in the diff you're reviewing — read the FULL diff before commenting
