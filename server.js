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

// ✅ Do NOT call express.json() globally before multer
// We’ll handle JSON manually in routes that expect JSON

const upload = multer({ dest: "uploads/" });

const PYTHON_OCR_URL = "https://img-to-text-main-1.onrender.com/extract";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// ✅ handle both file + text cases safely
app.post("/analyze-report", upload.single("file"), express.json(), async (req, res) => {
  try {
    let extractedText = "";

    // 🧠 Determine input type
    if (req.body?.text_input) {
      // Direct text input (textarea)
      extractedText = req.body.text_input;
      console.log("Received text input:", extractedText);
    } else if (req.file) {
      console.log("Received file:", req.file.originalname);

      const fileStream = fs.createReadStream(req.file.path);
      const formData = new FormData();
      formData.append("file", fileStream, req.file.originalname);

      const ocrResponse = await fetch(PYTHON_OCR_URL, {
        method: "POST",
        body: formData,
      });

      if (!ocrResponse.ok) {
        console.error("OCR failed:", await ocrResponse.text());
        return res.status(500).json({ error: "OCR service failed" });
      }

      const ocrData = await ocrResponse.json();
      extractedText = (ocrData.tests_raw || []).join("\n");
    } else {
      return res.status(400).json({ error: "No text or image provided" });
    }

    // ✅ Build Gemini prompt
    const prompt = `
You are a medical report summarizer...
(keep your original prompt here)
Lab results:
${extractedText}
`;

    // ✅ Call Gemini API
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
      return res.status(500).json({ error: "Gemini API failed", details: errText });
    }

    const geminiData = await geminiResponse.json();
    let summaryText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    summaryText = summaryText.replace(/```json|```/g, "").trim();

    let summaryJson;
    try {
      summaryJson = JSON.parse(summaryText);
    } catch (e) {
      return res.status(500).json({
        error: "Failed to parse Gemini output as JSON",
        raw: summaryText,
      });
    }

    // ✅ Respond cleanly
    res.json({
      input_text: extractedText,
      summary: summaryJson,
      status: "ok",
    });

    // 🧹 Optional cleanup
    if (req.file) fs.unlink(req.file.path, () => {});
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

app.listen(5000, () => console.log("Server running on port 5000"));


// Backend deployment - https://plum-backend-main.onrender.com
// OCR Extraction deployment - https://img-to-text-main-1.onrender.com/extract

// Check 1 : Image to text Extraction : curl.exe -X POST "https://img-to-text-main-1.onrender.com/extract" -F "file=@C:\Users\chand\Desktop\plum_backend-main\uploads\medical_report.png"
// Check 2 : text to simplification : curl.exe -X POST "https://plum-backend-main.onrender.com/analyze-report" -H "Content-Type: application/json" -d "{\"text_input\":\"CBC: Hemoglobin 10.2 g/dL (Low), WBC 11200 /uL (High)\"}"
// Check 3 : Image to text to simplification using Gemini API : curl.exe -X POST "https://plum-backend-main.onrender.com/analyze-report" -F "file=@C:\Users\chand\Desktop\plum_backend-main\uploads\medical_report.png"

