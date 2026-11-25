import mammoth from "mammoth";
import { normalizeText } from "./textClean";

/** Vercel serverless functions reject request bodies above ~4.5 MB, so files are capped at 4 MB and uploaded one per request. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export const RESUME_EXT = /\.(pdf|docx)$/i;

export function resumeMime(fileName: string, declared?: string): string {
  if (/\.pdf$/i.test(fileName)) return "application/pdf";
  if (/\.docx$/i.test(fileName)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return declared || "application/octet-stream";
}

/** PDF / DOCX / TXT / MD bytes → normalised plain text. Throws a user-readable Error on unsupported or empty files. */
export async function extractTextFromBuffer(fileName: string, mime: string, buf: Buffer): Promise<string> {
  const name = fileName.toLowerCase();
  let text = "";

  if (name.endsWith(".pdf") || mime === "application/pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    text = (await extractText(pdf, { mergePages: true })).text;
  } else if (name.endsWith(".docx")) {
    text = (await mammoth.extractRawText({ buffer: buf })).value;
  } else if (name.endsWith(".doc")) {
    throw new Error("Legacy .doc isn't supported — save it as .docx or PDF");
  } else if (/\.(txt|md|text)$/.test(name) || mime.startsWith("text/")) {
    text = buf.toString("utf8");
  } else {
    throw new Error("Unsupported file type. Upload a PDF, DOCX or TXT file");
  }

  text = normalizeText(text);
  if (text.length < 40) throw new Error("Couldn't read any text from the file (scanned image PDF?). Paste the text instead");
  return text;
}

export async function extractTextFromFile(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new Error("File is larger than 4 MB");
  return extractTextFromBuffer(file.name, file.type, Buffer.from(await file.arrayBuffer()));
}
