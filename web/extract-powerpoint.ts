import JSZip from "jszip";

const documentRelationships = [
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
];

async function readXml(zip: JSZip, path: string): Promise<Document | undefined> {
  const entry = zip.file(path);
  if (!entry) return undefined;
  // JSZip implements per-entry streaming, but omits it from JSZipObject's types.
  const reader = (entry as JSZip.JSZipObject & {
    internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
  }).internalStream("uint8array");
  const bytes = await new Promise<Uint8Array[]>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    reader.on("data", (chunk: Uint8Array) => {
      size += chunk.length;
      if (size > 2_000_000) {
        reader.pause();
        reject(new Error("파워포인트의 슬라이드 정보를 읽기에는 데이터가 너무 큽니다."));
        return;
      }
      chunks.push(chunk);
    }).on("error", reject).on("end", () => resolve(chunks)).resume();
  });
  const decoder = new TextDecoder();
  const xml = bytes.map(chunk => decoder.decode(chunk, { stream: true })).join("") + decoder.decode();
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("파워포인트 파일을 읽지 못했습니다.");
  return document;
}

export async function extractPowerPointBeginning(data: ArrayBuffer, maxCharacters: number): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  const presentation = await readXml(zip, "ppt/presentation.xml");
  const relationships = await readXml(zip, "ppt/_rels/presentation.xml.rels");
  if (!presentation || !relationships) throw new Error("파워포인트 파일을 읽지 못했습니다.");

  const targets = new Map<string, string>();
  for (const relation of relationships.getElementsByTagNameNS("*", "Relationship")) {
    const id = relation.getAttribute("Id");
    const target = relation.getAttribute("Target");
    const type = relation.getAttribute("Type");
    if (!id || !target || relation.getAttribute("TargetMode") === "External") continue;
    if (!documentRelationships.some(namespace => type === namespace + "/slide")) continue;
    const path = new URL(target, "https://presentation.invalid/ppt/presentation.xml");
    if (path.origin === "https://presentation.invalid") targets.set(id, path.pathname.slice(1));
  }

  const slideIds = Array.from(presentation.getElementsByTagNameNS("*", "sldId")).slice(0, 10);
  let result = "";
  let textLength = 0;
  for (const [index, slideId] of slideIds.entries()) {
    if (result.length >= maxCharacters || (index >= 5 && textLength >= 500)) break;
    const id = documentRelationships.map(namespace => slideId.getAttributeNS(namespace, "id")).find(Boolean);
    const path = id ? targets.get(id) : undefined;
    if (!path) continue;
    const slide = await readXml(zip, path);
    if (!slide || slide.documentElement.getAttribute("show") === "0") continue;
    const text = Array.from(slide.getElementsByTagNameNS("*", "p"))
      .map(paragraph => Array.from(paragraph.getElementsByTagNameNS("*", "t"))
        .map(run => run.textContent ?? "").join("").trim())
      .filter(Boolean).join("\n");
    if (!text) continue;
    textLength += text.length;
    result += `[슬라이드 ${index + 1}]\n${text}\n\n`;
  }
  return result.slice(0, maxCharacters).trim();
}
