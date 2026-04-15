export async function extractTextFromPdf(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/extract-text", { method: "POST", body: formData });
  const json = (await res.json()) as { text?: string; error?: string };
  if (!res.ok || !json.text) {
    throw new Error(json.error ?? "No se pudo extraer el texto del PDF.");
  }
  return json.text;
}
