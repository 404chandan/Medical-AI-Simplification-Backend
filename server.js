import express from "express";
import multer from "multer";
import fetch from "node-fetch";
import fs from "fs";
import dotenv from "dotenv";
import FormData from "form-data";
import cors from "cors";

dotenv.config();

const app = express();
app.use(cors());

const upload = multer({ dest: "uploads/" });

// External service endpoints
const PYTHON_OCR_URL = "https://img-to-text-main-1.onrender.com/extract";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

/**
 * POST /analyze-report
 * Accepts text_input (textarea) or file (image/PDF)
 */
app.post(
  "/analyze-report",
  upload.single("file"),
  express.json(),
  async (req, res) => {
    try {
      let extractedText = "";

      // 🧠 Determine input type
      if (req.body?.text_input) {
        // Case 1: Direct text input
        extractedText = req.body.text_input;
        console.log("✅ Received text input:", extractedText.slice(0, 100) + "...");
      } else if (req.file) {
        // Case 2: Uploaded file → send to OCR microservice
        console.log("📄 Received file:", req.file.originalname);

        const fileStream = fs.createReadStream(req.file.path);
        const formData = new FormData();
        formData.append("file", fileStream, req.file.originalname);

        const ocrResponse = await fetch(PYTHON_OCR_URL, {
          method: "POST",
          body: formData,
        });

        if (!ocrResponse.ok) {
          const errText = await ocrResponse.text();
          console.error("❌ OCR failed:", errText);
          return res.status(500).json({ error: "OCR service failed", details: errText });
        }

        const ocrData = await ocrResponse.json();
        extractedText = (ocrData.tests_raw || []).join("\n");
        console.log("✅ Extracted text from OCR:", extractedText.slice(0, 100) + "...");
      } else {
        return res.status(400).json({ error: "No text or image provided" });
      }

      // 🧾 Complete prompt for Gemini
      const prompt = `
You are a medical report summarizer.

Instructions:
1. Analyze the given medical report text.
2. Extract all test names and their results (e.g., High, Low, Normal).
3. Categorize the tests into sections: blood_work, liver, kidney, cholesterol, glucose.
4. For each test, provide its value/status under "summary".
5. Under "explanations", provide a short, patient-friendly explanation for each test, keyed by the test name.
6. Strictly follow this JSON structure:

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
- Return **only valid JSON** — no markdown, no commentary.
- Do NOT include phrases like "Here is the JSON".
- If any category has no data, omit it.
- Keep explanations short and friendly.

Lab results:
${extractedText}
`;

      // 🧠 Call Gemini API
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
        console.error("❌ Gemini API failed:", errText);
        return res.status(500).json({ error: "Gemini API failed", details: errText });
      }

      const geminiData = await geminiResponse.json();
      let summaryText =
        geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

      console.log("🧾 Raw Gemini output:", summaryText.slice(0, 200));

      // 🧹 Clean & extract JSON safely
      summaryText = summaryText
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .replace(/^Here.*?:/i, "")
        .trim();

      let summaryJson;
      try {
        summaryJson = JSON.parse(summaryText);
      } catch {
        const jsonMatch = summaryText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          summaryJson = JSON.parse(jsonMatch[0]);
        } else {
          console.error("❌ Failed to parse Gemini output as JSON.");
          return res.status(500).json({
            error: "Failed to parse Gemini output as JSON",
            raw: summaryText,
          });
        }
      }

      // ✅ Return clean JSON to frontend
      res.json({
        input_text: extractedText,
        summary: summaryJson,
        status: "ok",
      });

      // 🧹 Optional cleanup of uploaded file
      if (req.file) fs.unlink(req.file.path, () => {});
    } catch (err) {
      console.error("💥 Server error:", err);
      res.status(500).json({ error: "Server error", details: err.message });
    }
  }
);

// 🖥️ Start server
app.listen(5000, () => console.log("✅ Server running on port 5000"));
