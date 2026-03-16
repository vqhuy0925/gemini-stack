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

// Always include these config/doc formats regardless of language
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

// Artifacts/binaries to always exclude
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

  // Sort by file count descending so primary language is listed first
  detected.sort((a, b) => b.count - a.count);
  return detected.map((d) => d.lang);
}

function buildIncludePattern(langs) {
  const sourceExts = langs.flatMap((l) => LANGUAGE_EXTS[l] || []);
  const all = [...new Set([...sourceExts, ...ALWAYS_INCLUDE])];
  const escaped = all.map((e) => e.replace(".", "\\."));
  return new RegExp(`(${escaped.join("|")})$`, "i");
}

// ── File collection ───────────────────────────────────────────────────────────

function collectProjectFiles() {
  const result = tryExec("git ls-files");
  if (!result) return { files: [], langs: [] };

  const allFiles = result.split("\n").filter(Boolean);
  const langs = detectLanguages(allFiles);

  if (langs.length === 0) {
    // No recognised language — include everything that isn't a binary/artifact
    const files = allFiles.filter((f) => !EXCLUDE_PATTERN.test(f));
    return { files, langs: ["unknown"] };
  }

  const includePattern = buildIncludePattern(langs);
  const files = allFiles.filter(
    (f) => !EXCLUDE_PATTERN.test(f) && includePattern.test(f),
  );

  return { files, langs };
}

// ── Review context builders ───────────────────────────────────────────────────

async function buildReviewContext() {
  // ── FULL MODE ──────────────────────────────────────────────────────────────
  if (isFullMode) {
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

    const fileContents = files
      .map((f) => {
        try {
          const content = fs.readFileSync(f, "utf8");
          return `\n${"=".repeat(60)}\nFILE: ${f}\n${"=".repeat(60)}\n${content}`;
        } catch {
          return `\nFILE: ${f}\n[Could not read file]`;
        }
      })
      .join("\n");

    return (
      `Full project audit — ${files.length} files, detected languages: ${langs.join(", ")}.\n\n` +
      `Review the ENTIRE codebase below for:\n` +
      `- Bugs, logic flaws, and security vulnerabilities\n` +
      `- Missing error handling and edge cases\n` +
      `- LLM/AI trust boundary violations (unvalidated model output written to DB or passed to dangerous sinks)\n` +
      `- Hardcoded secrets, API keys, or credentials\n` +
      `- Deprecated or risky dependency usage\n` +
      `- Dead code, orphaned files, and unused imports\n` +
      `- Missing environment variable documentation (.env.example gaps)\n` +
      `- Source files with no corresponding test file\n` +
      `- Inline TODO/FIXME/HACK comments not tracked in TODOS.md\n` +
      `- Race conditions and concurrency issues\n` +
      `- Poor separation of concerns or structural red flags\n\n` +
      `Be terse: one line per problem, one line for the fix. Cite file:line. Skip anything that's fine.\n\n` +
      fileContents
    );
  }

  // ── PR MODE: diff against origin/main ─────────────────────────────────────
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

  // ── FALLBACK: uncommitted changes ─────────────────────────────────────────
  const uncommitted = tryExec("git diff HEAD");

  if (uncommitted) {
    console.log("Reviewing uncommitted changes...\n");
    return (
      `Here are my uncommitted code changes:\n\n${uncommitted}\n\n` +
      `Review for bugs, logic flaws, security issues, and missing error handling. ` +
      `Be terse: one line per problem, one line for the fix. Cite file:line.`
    );
  }

  // ── NOTHING TO REVIEW ─────────────────────────────────────────────────────
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
