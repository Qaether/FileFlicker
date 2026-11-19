import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth/mammoth.browser";
import { extractPowerPointBeginning } from "./extract-powerpoint";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
const maxCharacters = 20000;
const maxVisionPages = 3;

function imageCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  return canvas;
}

export async function extractBeginning(url: string, filename: string): Promise<{ text: string; images: string[] }> {
  const extension = filename.trim().split(".").pop()?.toLowerCase();
  if (!extension || !["txt", "md", "pdf", "docx", "pptx", "jpg", "jpeg", "png"].includes(extension)) {
    throw new Error("TXT, MD, PDF, DOCX, PPTX, JPG, JPEG, PNG 파일만 AI 생성이 가능합니다.");
  }
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error("파일을 읽지 못했습니다.");
  let text = "";
  const images: string[] = [];
  if (["jpg", "jpeg", "png"].includes(extension)) {
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
      const canvas = imageCanvas(bitmap.width * scale, bitmap.height * scale);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("이미지를 읽지 못했습니다.");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      images.push(canvas.toDataURL("image/jpeg", 0.8));
    } finally { bitmap.close(); }
  } else if (extension === "txt" || extension === "md") {
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
    } else if (extension === "pptx") {
      text = await extractPowerPointBeginning(data, maxCharacters);
    } else {
      const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
      try {
        for (let number = 1; number <= Math.min(pdf.numPages, 5) && text.length < maxCharacters; number++) {
          const page = await pdf.getPage(number);
          const content = await page.getTextContent();
          try {
            const pageText = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
            if (pageText) text += `[${number}페이지]\n${pageText}\n\n`;
            if (pageText.replace(/\s/g, "").length >= 40 || images.length >= maxVisionPages) continue;
            const original = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: 2048 / Math.max(original.width, original.height) });
            const canvas = imageCanvas(viewport.width, viewport.height);
            await page.render({ canvas, viewport }).promise;
            images.push(canvas.toDataURL("image/jpeg", 0.8));
          } finally { page.cleanup(); }
        }
      } finally { await pdf.destroy(); }
    }
  }
  text = text.slice(0, maxCharacters).trim();
  if (!text && !images.length) throw new Error("읽을 수 있는 텍스트가 없습니다.");
  return { text, images };
}
