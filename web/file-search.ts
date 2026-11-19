export interface SearchableFile {
  title: string | null;
  original_name: string;
  summary: string | null;
  tags: string[];
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/gu, " ").trim();
}

export function matchesFile(file: SearchableFile, search: string): boolean {
  const terms = normalize(search).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const fields = [file.title, file.original_name, file.summary, ...(file.tags ?? [])]
    .filter((value): value is string => typeof value === "string")
    .map(normalize);
  return terms.every(term => fields.some(field => field.includes(term)));
}

export function matchesOriginalName(file: SearchableFile, search: string): boolean {
  const terms = normalize(search).split(" ").filter(Boolean);
  if (!terms.length || !file.title || file.title === file.original_name) return false;
  const title = normalize(file.title);
  const original = normalize(file.original_name);
  return terms.some(term => original.includes(term) && !title.includes(term));
}
