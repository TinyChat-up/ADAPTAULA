// app/api/extract-text/route.ts
// Extracts plain text from uploaded PDF and DOCX files.
// No authentication required.

import { NextResponse } from "next/server";
import { extractText } from "unpdf";
import mammoth from "mammoth";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function detectFileType(file: File): "pdf" | "docx" | null {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) return "docx";

  return null;
}

export async function POST(req: Request) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Request must be multipart/form-data." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing 'file' field in form data." },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File exceeds the 10 MB limit (received ${(file.size / 1024 / 1024).toFixed(1)} MB).` },
      { status: 413 },
    );
  }

  const fileType = detectFileType(file);
  if (!fileType) {
    const label = file.type || `.${file.name.split(".").pop()}` || "unknown";
    return NextResponse.json(
      { error: `Unsupported file type: ${label}. Only PDF and DOCX are accepted.` },
      { status: 400 },
    );
  }

  const arrayBuffer = await file.arrayBuffer();

  try {
    if (fileType === "pdf") {
      const buffer = Buffer.from(arrayBuffer);
      const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
      return NextResponse.json({ text: text.trim() });
    }

    // docx
    const result = await mammoth.extractRawText({ buffer: Buffer.from(arrayBuffer) });
    return NextResponse.json({ text: result.value.trim() });

  } catch (error: unknown) {
    console.error("EXTRACT_TEXT_ERROR", {
      fileType,
      fileName: file.name,
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: "Failed to extract text from the file. The file may be corrupted or password-protected." },
      { status: 422 },
    );
  }
}
