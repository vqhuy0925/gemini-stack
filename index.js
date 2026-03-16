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
const userPrompt = args.slice(1).join(" ");

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
      console.log("Fetching git diff for review...");

      const diff = execSync("git diff HEAD").toString();

      if (!diff) {
        console.log("No uncommitted changes found to review.");
        return;
      }

      context = `Here are my uncommitted code changes:\n\n${diff}\n\nPlease review them for bugs, logic flaws, and security issues. Always keep in mind the core requirement of resilience for this event-driven service: it must be able to recover accurately even if all instances crash simultaneously, without relying on in-memory state.`;
    }

    console.log(`\n Thinking from the perspective of [${skillName}]...\n`);

    const result = await model.generateContent(context);
    console.log(result.response.text());
  } catch (error) {
    console.error("Error:", error.message);
  }
}

run();
