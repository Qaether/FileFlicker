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
  const displayedName = normalize(file.title || file.original_name);
  return terms.every(term => displayedName.includes(term));
}
