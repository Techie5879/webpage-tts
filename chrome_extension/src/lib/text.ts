export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function chunkText(text: string, maxLen: number): string[] {
  const cleaned = normalizeText(text);
  if (!cleaned) return [];
  if (cleaned.length <= maxLen) return [cleaned];

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(start + maxLen, cleaned.length);
    let slice = cleaned.slice(start, end);

    let splitAt = -1;
    const punctMatches = [". ", "! ", "? "];
    for (const punct of punctMatches) {
      const idx = slice.lastIndexOf(punct);
      if (idx > splitAt) splitAt = idx;
    }

    if (splitAt > 0 && end < cleaned.length) {
      end = start + splitAt + 1;
    } else if (end < cleaned.length) {
      const lastSpace = slice.lastIndexOf(" ");
      if (lastSpace > 0) end = start + lastSpace;
    }

    const chunk = cleaned.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start = end;
  }
  return chunks;
}
