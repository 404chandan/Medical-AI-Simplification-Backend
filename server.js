import express from "express";
import multer from "multer";
import fetch from "node-fetch";
import fs from "fs";
import dotenv from "dotenv";
import FormData from "form-data";
import cors from "cors";
import { promisify } from "util";

dotenv.config();
const unlinkAsync = promisify(fs.unlink);

const app = express();

// -------- Config --------
const PORT = process.env.PORT || 5000;

// CORS: allow Vercel frontend + local Vite dev
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://medical-ai-simplifier-cg6q.vercel.app",
];

app.use(
  cors({
    origin(origin, cb) {
      // allow no-origin requests (curl, server-to-server)
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false, // you are not using cookies
    maxAge: 86400,
  })
);

// Explicitly respond to preflights (some proxies require this)
app.options("*", cors());

// Hardcoded OCR microservice URL (as requested)
const PYTHON_OCR_URL = "https://img-to-text-main-1.onrender.com/extract";

// Gemini API key still comes from .env
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// Multer for uploads
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Body parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Health route
app.get("/health", (_req, res) => res.json({ ok: true }));

// Utility: fetch with timeout
const fetchWithTimeout = async (url, options = {}, ms = 30000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
};

// -------- Main endpoint --------
app.post("/analyze-report", upload.single("file"), async (req, res) => {
  let tmpFilePath = null;

  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY missing" });
    }

    let extractedText = "";

    // Case 1: text input
    if (req.body?.text_input && req.body.text_input.trim()) {
      extractedText = req.body.text_input.trim();
    }
    // Case 2: file -> OCR service
    else if (req.file) {
      tmpFilePath = req.file.path;
      const formData = new FormData();
      formData.append("file", fs.createReadStream(tmpFilePath), req.file.originalname);

      const ocrResp = await fetchWithTimeout(
        PYTHON_OCR_URL,
        { method: "POST", body: formData, headers: formData.getHeaders() },
        45000
      );

      if (!ocrResp.ok) {
        const errText = await ocrResp.text().catch(() => "");
        return res.status(502).json({ error: "OCR service failed", details: errText });
      }

      const ocrJson = await ocrResp.json();
      extractedText = (ocrJson.tests_raw || []).join("\n");
      if (!extractedText) {
        return res.status(422).json({ error: "OCR returned no text" });
      }
    } else {
      return res.status(400).json({ error: "Provide text_input or file" });
    }

    // Build Gemini prompt
    const prompt = `
You are a medical report simplifier. Summarize the following lab results in patient-friendly language (no diagnosis, just observations).
Return ONLY a JSON object (no explanations, no markdown).

Lab results:

${extractedText}
`.trim();

    // Call Gemini API
    const aiResp = await fetchWithTimeout(
      `${GEMINI_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
      45000
    );

    if (!aiResp.ok) {
      const t = await aiResp.text().catch(() => "");
      return res.status(502).json({ error: "Gemini API failed", details: t || `HTTP ${aiResp.status}` });
    }

    const aiJson = await aiResp.json();
    let textOut = aiJson?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    textOut = textOut.replace(/```json|```/g, "").trim();

    let summary;
    try {
      summary = JSON.parse(textOut);
    } catch {
      return res.status(500).json({ error: "Failed to parse Gemini output", raw: textOut });
    }

    res.json({ status: "ok", input_text: extractedText, summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error", details: String(err) });
  } finally {
    if (tmpFilePath) unlinkAsync(tmpFilePath).catch(() => {});
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Node.js service running on http://localhost:${PORT}`);
});
