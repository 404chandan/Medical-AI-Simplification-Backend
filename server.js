import express from "express";
import multer from "multer";
import fetch from "node-fetch";
import fs from "fs";
import dotenv from "dotenv";
import FormData from "form-data";
import cors from "cors";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });
app.use(cors());
app.use(express.json());

// -----------------------------
// Configuration
// -----------------------------
const PYTHON_OCR_URL = "https://medical-report-ocr-production.up.railway.app";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// -----------------------------
// Endpoint: /analyze-report
// -----------------------------
app.post("/analyze-report", upload.single("file"), async (req, res) => {
  console.log("Received request...");
  try {
    let extractedText = "";

    // -------------------------------------
    // Step 1: Get text (from textarea or OCR)
    // -------------------------------------
    if (req.body.text_input) {
      extractedText = req.body.text_input;
      console.log("Received text input:", extractedText);
    } else if (req.file) {
      const fileStream = fs.createReadStream(req.file.path);
      const formData = new FormData();
      formData.append("file", fileStream, req.file.originalname);

      const ocrResponse = await fetch(PYTHON_OCR_URL, {
        method: "POST",
        body: formData,
      });

      if (!ocrResponse.ok) {
        return res.status(500).json({ error: "OCR service failed" });
      }

      const data = await ocrResponse.json();
      extractedText = (data.tests_raw || []).join("\n");
      console.log("Extracted OCR text:", extractedText);
    } else {
      return res.status(400).json({ error: "No text or image provided" });
    }

    // -------------------------------------
    // Step 2: Gemini Call #1 – Structured JSON
    // -------------------------------------
    const jsonPrompt = `
You are a medical report summarizer.

Task:
Analyze the following medical report text and extract all lab tests and their results.

Rules:
- Categorize tests into: blood_work, liver, kidney, cholesterol, glucose.
- For each test, indicate its status: High, Low, or Normal.
- Provide short explanations for each test.
- Return ONLY valid JSON in this exact format:

{
  "input_text": "<original report text>",
  "summary": {
    "blood_work": {...},
    "liver": {...},
    "kidney": {...},
    "cholesterol": {...},
    "glucose": {...}
  },
  "explanations": {...},
  "status": "ok"
}

Do not include any extra commentary.

Lab results:
${extractedText}
`;

    const geminiJsonResp = await fetch(
      `${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: jsonPrompt }] }],
        }),
      }
    );

    if (!geminiJsonResp.ok) {
      const errText = await geminiJsonResp.text();
      return res
        .status(500)
        .json({ error: "Gemini JSON generation failed", details: errText });
    }

    const geminiJsonData = await geminiJsonResp.json();
    let structuredText =
      geminiJsonData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    structuredText = structuredText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    let structuredJson;
    try {
      structuredJson = JSON.parse(structuredText);
    } catch (parseErr) {
      return res.status(500).json({
        error: "Failed to parse Gemini JSON output",
        raw: structuredText,
      });
    }

    // -------------------------------------
    // Step 3: Gemini Call #2 – Natural Summary Paragraph
    // -------------------------------------
    const summaryPrompt = `
You are a clinical summarizer.

Based on the following structured lab test results, write a concise, patient-friendly paragraph summarizing the findings.

Instructions:
- Mention which tests are abnormal (High/Low).
- Suggest possible affected organs/systems.
- List probable diseases or deficiencies (plain English).
- Add a reassuring line such as: "Please consult your doctor for further evaluation."
- Keep it under 150 words.

Here is the structured data:
${JSON.stringify(structuredJson, null, 2)}
`;

    const geminiTextResp = await fetch(
      `${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: summaryPrompt }] }],
        }),
      }
    );

    if (!geminiTextResp.ok) {
      const errText = await geminiTextResp.text();
      return res
        .status(500)
        .json({ error: "Gemini summary generation failed", details: errText });
    }

    const geminiTextData = await geminiTextResp.json();
    const paragraphSummary =
      geminiTextData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "No summary generated.";

    // -------------------------------------
    // Step 4: Return Final Combined Response
    // -------------------------------------
    res.json({
      input_text: extractedText,
      structured_summary: structuredJson,
      paragraph_summary: paragraphSummary,
      status: "ok",
    });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// -----------------------------
// Server Startup
// -----------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Node.js service running on http://localhost:${PORT}`);
});
