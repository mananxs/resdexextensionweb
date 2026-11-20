import mammoth from "mammoth";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** PDF / DOCX / TXT / MD → plain text. Throws a user-readable Error on unsupported or empty files. */
export async function extractTextFromFile(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new Error("File is larger than 5 MB");
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  let text = "";

  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    text = (await extractText(pdf, { mergePages: true })).text;
  } else if (name.endsWith(".docx")) {
    text = (await mammoth.extractRawText({ buffer: buf })).value;
  } else if (name.endsWith(".doc")) {
    throw new Error("Legacy .doc isn't supported — save it as .docx or PDF");
  } else if (/\.(txt|md|text)$/.test(name) || file.type.startsWith("text/")) {
    text = buf.toString("utf8");
  } else {
    throw new Error("Unsupported file type. Upload a PDF, DOCX or TXT file");
  }

  text = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 40) throw new Error("Couldn't read any text from the file (scanned image PDF?). Paste the text instead");
  return text;
}
