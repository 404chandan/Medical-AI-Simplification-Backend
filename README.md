**Summary**

This project is called AI Medical Report Simplifier.
It helps patients understand their medical reports easily. A user can either upload a file or paste the text of the report. The system then sends this to the backend. The backend extracts important test results, checks if they are normal, low, or high, and gives a clear explanation in simple words using Gemini AI. The frontend shows the results neatly in a table with colored highlights.

**Tech Stack Used**

Frontend: React + Tailwind CSS + Lucide React Icons

Backend: Node.js + Express

Other Tools: Multer for file upload, Fetch API for server calls

**Hosting:**

Frontend on Vercel

Backend on Render

**Setup**

Clone the repos:

Frontend: git clone https://github.com/404chandan/Medical-AI-simplification

Backend : https://github.com/404chandan/Medical-AI-Simplification-Backend

OCR Text Extractor: git clone https://github.com/404chandan/img_to_text-main

Install dependencies:

npm install

Create a .env file and add API keys (for OCR / Gemini if used).

**Run locally:**

Frontend: npm run dev

Backend: node server.js

Or use deployed links directly:

**Frontend (UI)**: https://medical-ai-simplifiers.vercel.app

**Backend API**: https://plum-backend-main.onrender.com/analyze-report

**Working :**

<img width="1767" height="708" alt="image" src="https://github.com/user-attachments/assets/d56574b5-af65-474e-ba72-03d5b6cd1af7" />
<img width="1790" height="676" alt="image" src="https://github.com/user-attachments/assets/82fd2994-ea03-4901-afb7-1d7c8642d726" />
<img width="1474" height="629" alt="image" src="https://github.com/user-attachments/assets/a2ab0dd7-52fb-405d-a892-fd2c63cd2a51" />

**Watch demo**: https://youtu.be/WwZf9NbQq8s



