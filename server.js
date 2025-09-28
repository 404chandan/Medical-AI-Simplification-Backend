import express from "express";
import multer from "multer";
import fetch from "node-fetch";
import fs from "fs";
import dotenv from "dotenv";
import FormData from "form-data";
import cors from "cors";
import { promisify } from "util";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/", limits: { fileSize: 10 * 1024 * 1024 } });
const unlinkAsync = promisify(fs.unlink);

// Allow all origins during dev; tighten if you like
app.use(cors());

// Parsers (leave Content-Type to the browser/FormData)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// -------- Config --------
const PORT = process.env.PORT || 5000;
const PYTHON_OCR_URL = "https://img-to-text-main-1.onrender.com/extract";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

/**
 * POST /analyze-report
 * Accepts text OR image
 */
app.post("/analyze-report", upload.single("file"), async (req, res) => {
  let tmpFilePath = null;

  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY missing" });
    }

    let extractedText = "";

    if (req.body?.text_input) {
      // Case 1: Direct text input (from textarea)
      extractedText = String(req.body.text_input || "").trim();
      if (!extractedText) {
        return res.status(400).json({ error: "Empty text_input provided" });
      }
    } else if (req.file) {
      // Case 2: File input → send to Python OCR service
      tmpFilePath = req.file.path;

      const fileStream = fs.createReadStream(tmpFilePath);
      const formData = new FormData();
      formData.append("file", fileStream, req.file.originalname);

      const response = await fetch(PYTHON_OCR_URL, {
        method: "POST",
        body: formData,
        headers: formData.getHeaders(), // important for node-fetch + form-data
      });

      if (!response.ok) {
        const t = await response.text().catch(() => "");
        return res.status(502).json({ error: "OCR service failed", details: t || `HTTP ${response.status}` });
      }

      const data = await response.json().catch(() => ({}));
      extractedText = Array.isArray(data.tests_raw) ? data.tests_raw.join("\n") : "";
      if (!extractedText) {
        return res.status(422).json({ error: "OCR returned no text" });
      }
    } else {
      return res.status(400).json({ error: "No text or image provided" });
    }

    // Build the prompt for clean JSON output
    const prompt = `
You are a medical report simplifier. Summarize the following lab results in patient-friendly language (no diagnosis, just observations).
Return ONLY a JSON object with a short summary and (optionally) a few simple explanations. Keep it concise and easy to understand.

Example format (you may adapt keys to the input):
{
  "summary": "Low hemoglobin and high white blood cell count.",
  "explanations": [
    "Low hemoglobin may relate to anemia.",
    "High WBC can occur with infections."
  ]
}

Lab results:

${extractedText}
`.trim();

    // Call Gemini API
    const geminiResponse = await fetch(
      `${GEMINI_URL}?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text().catch(() => "");
      return res.status(502).json({ error: "Gemini API failed", details: errText || `HTTP ${geminiResponse.status}` });
    }

    const geminiData = await geminiResponse.json().catch(() => ({}));

    // Extract model text and remove markdown code fences if present
    let summaryText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Safely strip triple-backtick fences such as ```json ... ```
    summaryText = summaryText.replace(/```json|```/g, "").trim();

    // Parse JSON safely
    let summaryJson;
    try {
      summaryJson = summaryText ? JSON.parse(summaryText) : {};
    } catch (parseErr) {
      return res.status(500).json({
        error: "Failed to parse Gemini output as JSON",
        raw: summaryText,
      });
    }

    return res.json({
      input_text: extractedText,
      summary: summaryJson,
      status: "ok",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  } finally {
    if (tmpFilePath) {
      unlinkAsync(tmpFilePath).catch(() => {});
    }
  }
});

app.listen(PORT, () => {
  console.log(`Node.js service running on http://localhost:${PORT}`);
});
