import * as dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("GEMINI_API_KEY not set");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function listModels() {
    try {
        // The SDK doesn't have a direct listModels, we usually use the REST API or know the names.
        // But we can try to initialize one and see if it fails.
        const models = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash-exp", "gemini-3-flash-preview"];
        for (const m of models) {
            console.log(`Checking model: ${m}`);
            try {
                const model = genAI.getGenerativeModel({ model: m });
                // We'll try a very short generation to see if it's valid
                const result = await model.generateContent("test");
                console.log(`  - ${m} is valid. Response: ${result.response.text().substring(0, 10)}...`);
            } catch (e) {
                console.log(`  - ${m} failed: ${e.message}`);
            }
        }
    } catch (error) {
        console.error(error);
    }
}

listModels();
