import express from "express";
import multer from "multer";
import fetch from "node-fetch";
import fs from "fs";
import dotenv from "dotenv";
import FormData from "form-data";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });

// Python OCR microservice endpoint
const PYTHON_OCR_URL = "http://localhost:8000/extract";

// Gemini REST endpoint
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

/**
 * POST /analyze-report
 * Accepts text OR image
 */
app.post("/analyze-report", upload.single("file"), async (req, res) => {
  try {
    let extractedText = "";

    if (req.body.text_input) {
      // Case 1: Direct text input (from textarea)
      extractedText = req.body.text_input;
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
You are a medical report simplifier. Summarize the following lab results in patient-friendly language (no diagnosis, just observations). 
Return ONLY a JSON object (no explanations, no markdown) with this structure:

{
  "lab_results": {
    "CBC": {
      "hemoglobin": "...",
      "white_blood_cells": "...",
      "red_blood_cells": "..."
    },
    "liver_function": {
      "ALT": "...",
      "AST": "...",
      "bilirubin": "..."
    },
    "kidney_function": {
      "creatinine": "...",
      "BUN": "..."
    },
    "cholesterol": {
      "total_cholesterol": "...",
      "HDL": "...",
      "LDL": "...",
      "triglycerides": "..."
    }
  }
}

Lab results:

${extractedText}
    `;

    // Call Gemini API
    const geminiResponse = await fetch(
      ${GEMINI_URL}?key=${process.env.GEMINI_API_KEY},
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
    summaryText = summaryText.replace(/json|/g, "").trim();

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