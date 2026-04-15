import { extractTextFromPdf } from "@/lib/extractPdfText";

export async function extractTextFromDocument(file: File) {
  const mimeType = file.type;
  const fileName = file.name.toLowerCase();

  if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) {
    return extractTextFromPdf(file);
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.endsWith(".docx")
  ) {
    const mammoth = await import("mammoth/mammoth.browser");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return (result.value || "").trim();
  }

  if (mimeType === "text/plain" || fileName.endsWith(".txt")) {
    return (await file.text()).trim();
  }

  if (fileName.endsWith(".doc")) {
    throw new Error(
      "El formato .doc no está soportado todavía. Usa PDF o DOCX.",
    );
  }

  throw new Error("Formato no soportado. Usa PDF, DOCX o texto.");
}
