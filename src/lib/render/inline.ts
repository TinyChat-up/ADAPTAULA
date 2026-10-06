/** The restricted inline markup of `RichText` fields (`**bold**`, `_italic_`), parsed into runs. Never HTML: text stays text. */
export interface Run {
  text: string;
  bold?: true;
  italic?: true;
}

const TOKEN = /\*\*([^*]+)\*\*|(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/g;

export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > last) runs.push({ text: text.slice(last, match.index) });
    runs.push(match[1] !== undefined ? { text: match[1], bold: true } : { text: match[2]!, italic: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.length > 0 ? runs : [{ text }];
}

/** Paragraphs of a long prompt (blank-line separated), each as runs. */
export const parseParagraphs = (text: string): Run[][] =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(parseInline);

export type BlankPart = { text: string } | { blank: true };

/** `{{key}}` marks a blank; the key (and any answer) never reaches the sheet. */
export function parseBlanks(text: string): BlankPart[] {
  const parts: BlankPart[] = [];
  let last = 0;
  for (const match of text.matchAll(/\{\{[^}]*\}\}/g)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ blank: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
