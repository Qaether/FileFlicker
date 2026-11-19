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
  const fields = [file.title || file.original_name, file.summary ?? "", ...(file.tags ?? [])].map(normalize);
  return terms.every(term => fields.some(field => field.includes(term)));
}
