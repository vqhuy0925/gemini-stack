#!/usr/bin/env node
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import { execSync } from "child_process";

// Retrieve API Key from environment variables
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Error: GEMINI_API_KEY environment variable is not set.");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

// Get command line arguments (e.g., g-stack review)
const args = process.argv.slice(2);
const skillName = args[0]; // 'plan-ceo', 'review', etc.
const userPrompt = args.slice(1).join(" ");

async function run() {
  try {
    // 1. Read the System Prompt corresponding to the requested role
    const systemInstruction = fs.readFileSync(
      `./skills/${skillName}.md`,
      "utf8",
    );

    // 2. Initialize the Gemini 1.5 Pro model with the System Instruction
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-pro",
      systemInstruction: systemInstruction,
    });

    let context = userPrompt;

    // 3. Handle special commands (similar to gstack)
    if (skillName === "review") {
      console.log("Fetching git diff for review...");

      // Grab uncommitted code changes for Gemini to analyze
      const diff = execSync("git diff HEAD").toString();

      if (!diff) {
        console.log("No uncommitted changes found to review.");
        return;
      }

      context = `Here are my uncommitted code changes:\n\n${diff}\n\nPlease review them for bugs, logic flaws, and security issues.`;
    }

    console.log(`\n🧠 Thinking from the perspective of [${skillName}]...\n`);

    // 4. Send the request to Gemini
    const result = await model.generateContent(context);
    console.log(result.response.text());
  } catch (error) {
    console.error("Error:", error.message);
  }
}

run();
