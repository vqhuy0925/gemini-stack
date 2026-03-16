#!/usr/bin/env node
import * as dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Error: GEMINI_API_KEY is not set in the .env file.");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

const args = process.argv.slice(2);
const skillName = args[0];
const skillArgs = args.slice(1);
const isFullMode = skillArgs.includes("--full");
const userPrompt = skillArgs.filter((a) => !a.startsWith("--")).join(" ");

// Max characters per chunk sent to Gemini.
// ~150k chars ≈ ~37k tokens — safely under the 250k token/min free tier limit.
// Increase to 400000 if you are on a paid tier.
const CHUNK_SIZE_CHARS = 150_000;

// Delay between chunk requests (ms) to respect per-minute rate limits.
const CHUNK_DELAY_MS = 5_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function tryExec(cmd) {
  try {
    return execSync(cmd, { stdio: ["pipe", "pipe", "pipe"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Language detection ────────────────────────────────────────────────────────

const LANGUAGE_EXTS = {
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  typescript: [".ts", ".tsx"],
  java: [".java"],
  kotlin: [".kt", ".kts"],
  python: [".py"],
  go: [".go"],
  ruby: [".rb"],
  csharp: [".cs"],
  cpp: [".cpp", ".cc", ".cxx", ".c", ".h", ".hpp"],
  php: [".php"],
  rust: [".rs"],
  swift: [".swift"],
  scala: [".scala"],
};

const ALWAYS_INCLUDE = [
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".md",
  ".toml",
  ".properties",
  ".env",
  ".gradle",
  ".sh",
  ".bat",
  ".ps1",
];

const EXCLUDE_PATTERN = new RegExp(
  [
    "node_modules",
    "dist",
    "build",
    "\\.min\\.",
    "coverage",
    "\\.lock$",
    "package-lock\\.json",
    "\\.jpg$",
    "\\.png$",
    "\\.gif$",
    "\\.svg$",
    "\\.ico$",
    "\\.class$",
    "\\.jar$",
    "\\.war$",
    "\\.ear$",
    "(^|[\\\\/])target[\\\\/]",
    "\\.gradle[\\\\/]caches",
    "__pycache__",
    "\\.pyc$",
    "\\.o$",
    "\\.obj$",
    "\\.exe$",
    "\\.dll$",
  ].join("|"),
);

function detectLanguages(files) {
  const extCount = {};
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (ext) extCount[ext] = (extCount[ext] || 0) + 1;
  }
  const detected = [];
  for (const [lang, exts] of Object.entries(LANGUAGE_EXTS)) {
    const count = exts.reduce((sum, e) => sum + (extCount[e] || 0), 0);
    if (count > 0) detected.push({ lang, count });
  }
  detected.sort((a, b) => b.count - a.count);
  return detected.map((d) => d.lang);
}

function buildIncludePattern(langs) {
  const sourceExts = langs.flatMap((l) => LANGUAGE_EXTS[l] || []);
  const all = [...new Set([...sourceExts, ...ALWAYS_INCLUDE])];
  const escaped = all.map((e) => e.replace(".", "\\."));
  return new RegExp(`(${escaped.join("|")})$`, "i");
}

function collectProjectFiles() {
  const result = tryExec("git ls-files");
  if (!result) return { files: [], langs: [] };

  const allFiles = result.split("\n").filter(Boolean);
  const langs = detectLanguages(allFiles);

  if (langs.length === 0) {
    const files = allFiles.filter((f) => !EXCLUDE_PATTERN.test(f));
    return { files, langs: ["unknown"] };
  }

  const includePattern = buildIncludePattern(langs);
  const files = allFiles.filter(
    (f) => !EXCLUDE_PATTERN.test(f) && includePattern.test(f),
  );
  return { files, langs };
}

// ── Chunking ──────────────────────────────────────────────────────────────────

/**
 * Split files into chunks where each chunk's total character count
 * stays under CHUNK_SIZE_CHARS. A single file that exceeds the limit
 * is included alone in its own chunk (truncated with a warning).
 */
function chunkFiles(files) {
  const chunks = [];
  let current = [];
  let currentSize = 0;

  for (const f of files) {
    let content;
    try {
      content = fs.readFileSync(f, "utf8");
    } catch {
      content = "[Could not read file]";
    }

    const block = `\n${"=".repeat(60)}\nFILE: ${f}\n${"=".repeat(60)}\n${content}`;
    const blockSize = block.length;

    // If this single file is larger than the chunk limit, truncate it
    const safeBlock =
      blockSize > CHUNK_SIZE_CHARS
        ? block.slice(0, CHUNK_SIZE_CHARS) +
          `\n... [TRUNCATED — file exceeds ${CHUNK_SIZE_CHARS} chars]`
        : block;

    if (
      currentSize + safeBlock.length > CHUNK_SIZE_CHARS &&
      current.length > 0
    ) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }

    current.push({ file: f, block: safeBlock });
    currentSize += safeBlock.length;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

// ── Gemini call ───────────────────────────────────────────────────────────────

async function callGemini(model, context) {
  const result = await model.generateContent(context);
  return result.response.text();
}

// ── Full-mode chunked review ──────────────────────────────────────────────────

async function runFullReview(model, files, langs) {
  const chunks = chunkFiles(files);
  const totalChunks = chunks.length;

  if (totalChunks === 1) {
    // Small project — single request, same as before
    const fileContents = chunks[0].map((c) => c.block).join("\n");
    const context =
      `Full project audit — ${files.length} files, languages: ${langs.join(", ")}.\n\n` +
      buildFullPromptInstructions() +
      fileContents;

    console.log(`\nThinking from the perspective of [${skillName}]...\n`);
    const response = await callGemini(model, context);
    console.log(response);
    return;
  }

  // Large project — process in chunks, then summarise
  console.log(
    `Project is large — splitting into ${totalChunks} chunks to stay within token limits.\n`,
  );

  const chunkFindings = [];

  for (let i = 0; i < totalChunks; i++) {
    const chunk = chunks[i];
    const fileList = chunk.map((c) => c.file).join(", ");
    console.log(
      `Reviewing chunk ${i + 1}/${totalChunks} (${chunk.length} files)...`,
    );

    const fileContents = chunk.map((c) => c.block).join("\n");
    const context =
      `Full project audit — chunk ${i + 1} of ${totalChunks}.\n` +
      `Files in this chunk: ${fileList}\n\n` +
      buildFullPromptInstructions() +
      `Return ONLY the issues found in these files. ` +
      `Format each issue as: [file:line] Problem — Fix\n\n` +
      fileContents;

    const response = await callGemini(model, context);
    chunkFindings.push(
      `--- Chunk ${i + 1} (${chunk.length} files) ---\n${response}`,
    );

    // Wait between chunks to avoid per-minute token limit
    if (i < totalChunks - 1) {
      console.log(`  Waiting ${CHUNK_DELAY_MS / 1000}s before next chunk...`);
      await sleep(CHUNK_DELAY_MS);
    }
  }

  // Final pass: merge and de-duplicate findings
  console.log(`\nMerging findings from all ${totalChunks} chunks...\n`);
  await sleep(CHUNK_DELAY_MS);

  const mergeContext =
    `You reviewed a project in ${totalChunks} chunks. Here are the raw findings from each chunk:\n\n` +
    chunkFindings.join("\n\n") +
    `\n\nNow produce a single consolidated report:\n` +
    `1. De-duplicate — if the same issue appears in multiple chunks, list it once.\n` +
    `2. Sort by severity: CRITICAL issues first, then informational.\n` +
    `3. Format:\n\n` +
    `   Full Project Review: N issues (X critical, Y informational)\n\n` +
    `   **CRITICAL:**\n` +
    `   - [file:line] Problem\n` +
    `     Fix: suggested fix\n\n` +
    `   **Issues:**\n` +
    `   - [file:line] Problem\n` +
    `     Fix: suggested fix\n\n` +
    `Be terse. No preamble. Only real problems.`;

  console.log(`\nThinking from the perspective of [${skillName}]...\n`);
  const summary = await callGemini(model, mergeContext);
  console.log(summary);
}

function buildFullPromptInstructions() {
  return (
    `Review the code below for:\n` +
    `- Bugs, logic flaws, and security vulnerabilities\n` +
    `- Missing error handling and edge cases\n` +
    `- LLM/AI trust boundary violations\n` +
    `- Hardcoded secrets, API keys, or credentials\n` +
    `- Deprecated or risky dependency usage\n` +
    `- Dead code, orphaned files, and unused imports\n` +
    `- Race conditions and concurrency issues\n` +
    `- Source files with no corresponding test file\n` +
    `- Inline TODO/FIXME/HACK comments\n\n` +
    `Be terse: one line per problem, one line for the fix. Cite file:line. Skip anything fine.\n\n`
  );
}

// ── Review context (PR / uncommitted modes) ───────────────────────────────────

async function buildReviewContext() {
  // PR MODE
  tryExec("git fetch origin main --quiet");
  const prDiff = tryExec("git diff origin/main");

  if (prDiff) {
    console.log("PR mode — reviewing diff against origin/main...\n");
    return (
      `Here is the diff of this branch against main:\n\n${prDiff}\n\n` +
      `Review for bugs, logic flaws, security issues, missing error handling, ` +
      `and LLM trust boundary violations. Only flag issues introduced in this diff. ` +
      `Be terse: one line per problem, one line for the fix. Cite file:line.`
    );
  }

  // FALLBACK: uncommitted changes
  const uncommitted = tryExec("git diff HEAD");

  if (uncommitted) {
    console.log("Reviewing uncommitted changes...\n");
    return (
      `Here are my uncommitted code changes:\n\n${uncommitted}\n\n` +
      `Review for bugs, logic flaws, security issues, and missing error handling. ` +
      `Be terse: one line per problem, one line for the fix. Cite file:line.`
    );
  }

  console.log(
    "Nothing to review — no diff against origin/main and no uncommitted changes.",
  );
  console.log("Tip: run `g-stack review --full` to audit the entire codebase.");
  process.exit(0);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  try {
    const skillPath = path.join(__dirname, "skills", `${skillName}.md`);
    const systemInstruction = fs.readFileSync(skillPath, "utf8");

    const model = genAI.getGenerativeModel({
      model: "gemini-3-flash-preview",
      systemInstruction: systemInstruction,
    });

    if (skillName === "review" && isFullMode) {
      console.log("Full project review mode — detecting languages...");
      const { files, langs } = collectProjectFiles();

      if (files.length === 0) {
        console.error(
          "No source files found. Make sure you're inside a git repository.",
        );
        process.exit(1);
      }

      console.log(`Detected: ${langs.join(", ")}`);
      console.log(`Scanning ${files.length} files...\n`);
      await runFullReview(model, files, langs);
      return;
    }

    let context = userPrompt;
    if (skillName === "review") {
      context = await buildReviewContext();
    }

    console.log(`\nThinking from the perspective of [${skillName}]...\n`);
    const result = await model.generateContent(context);
    console.log(result.response.text());
  } catch (error) {
    console.error("Error:", error.message);
  }
}

run();
