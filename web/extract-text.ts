import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth/mammoth.browser";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
const maxCharacters = 20000;

export async function extractBeginning(url: string, filename: string): Promise<string> {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (!extension || !["txt", "md", "pdf", "docx"].includes(extension)) {
    throw new Error("TXT, MD, PDF, DOCX 파일만 AI 생성이 가능합니다.");
  }
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error("파일을 읽지 못했습니다.");
  let text = "";
  if (extension === "txt" || extension === "md") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      while (text.length < maxCharacters) {
        const result = await reader.read();
        if (result.done) break;
        text += decoder.decode(result.value, { stream: true });
      }
    } finally { await reader.cancel(); }
  } else {
    const data = await response.arrayBuffer();
    if (extension === "docx") {
      text = (await mammoth.extractRawText({ arrayBuffer: data })).value;
    } else {
      const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
      try {
        for (let number = 1; number <= Math.min(pdf.numPages, 5) && text.length < maxCharacters; number++) {
          const page = await pdf.getPage(number);
          const content = await page.getTextContent();
          text += content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("") + "\n";
          page.cleanup();
        }
      } finally { await pdf.destroy(); }
    }
  }
  text = text.slice(0, maxCharacters).trim();
  if (!text) throw new Error("읽을 수 있는 텍스트가 없습니다.");
  return text;
}
