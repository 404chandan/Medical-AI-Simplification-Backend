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
app.use(express.json()); // allow JSON bodies for text_input

// Python OCR microservice endpoint
const PYTHON_OCR_URL = "https://img-to-text-main-1.onrender.com/extract";

// Gemini REST endpoint
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

/**
 * POST /analyze-report
 * Accepts text OR image
 */
app.post("/analyze-report", upload.single("file"), async (req, res) => {
  console.log("Received request with body:", req.body.text_input);
  try {
    let extractedText = "";

    if (req.body.text_input) {
      // Case 1: Direct text input (from textarea)
      extractedText = req.body.text_input;
      console.log("Received text input:", extractedText);
    } else if (req.file) {
      // Case 2: File input → send to Python OCR service
      const fileStream = fs.createReadStream(req.file.path);

      const formData = new FormData();
      formData.append("file", fileStream, req.file.originalname);

      const response = await fetch(PYTHON_OCR_URL, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        return res.status(500).json({ error: "OCR service failed" });
      }

      const data = await response.json();
      extractedText = (data.tests_raw || []).join("\n");
    } else {
      return res.status(400).json({ error: "No text or image provided" });
    }

    // Build the prompt for clean JSON output
    const prompt = `
You are a medical report summarizer. 

Instructions:
1. Analyze the given medical report text.
2. Extract all test names and their results.
3. Categorize tests into sections: blood_work, liver, kidney, cholesterol, glucose.
4. For each test, provide its value/status (High, Low, Normal) under "summary".
5. Under "explanations", provide a short, patient-friendly explanation for each test, keyed by the test name.
6. Stick exactly to this JSON structure:

{
  "input_text": "<original report text>",
  "summary": {
    "blood_work": {
      "iron_protein": "Low",
      "defense_cells": "High",
      "oxygen_cells": "Low",
      "clot_factors": "Normal"
    },
    "liver": {
      "hepatic_marker_x": "High",
      "hepatic_marker_y": "High",
      "bile_substance": "Normal",
      "serum_protein": "Low"
    },
    "kidney": {
      "toxin_clearance": "High",
      "nitrogen_compound": "High"
    },
    "cholesterol": {
      "cholesterol_total": "High",
      "cholesterol_bad": "High",
      "cholesterol_good": "Low",
      "stored_fats": "High"
    },
    "glucose": {
      "fasting_glucose": "High"
    }
  },
  "explanations": {
    "iron_protein": "Short patient-friendly explanation",
    "defense_cells": "Short patient-friendly explanation",
    "...": "..."
  },
  "status": "ok"
}

Rules:
- Do NOT add any additional fields or nesting.
- Always return valid JSON, no extra text or commentary.
- Use only the specified keys.
- Map tests carefully; if a test is missing, omit it.
- Keep explanations concise and patient-friendly.

Lab results:

${extractedText}
`;

    // Call Gemini API
    const geminiResponse = await fetch(
      `${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      return res
        .status(500)
        .json({ error: "Gemini API failed", details: errText });
    }

    const geminiData = await geminiResponse.json();

    let summaryText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No summary found";

    // Remove markdown fences if any
    console.log("Raw Gemini output:", summaryText);
    summaryText = summaryText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    console.log("New Gemini output:", summaryText);

    // Parse JSON safely
    let summaryJson;
    try {
      summaryJson = JSON.parse(summaryText);
    } catch (parseErr) {
      return res.status(500).json({
        error: "Failed to parse Gemini output as JSON",
        raw: summaryText,
      });
    }

    console.log(summaryJson);
    res.json({
      input_text: extractedText,
      summary: summaryJson,
      status: "ok",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(5000, () => {
  console.log("Node.js service running on http://localhost:5000");
});
