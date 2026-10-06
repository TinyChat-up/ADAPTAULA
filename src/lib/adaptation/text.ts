/**
 * Deterministic text helpers for the invariants and the review. They never decide pedagogy by themselves: they find the
 * tokens that must survive an adaptation (numbers, ranges, quantifiers, units) and the traces of an answer.
 */

/** Lowercase, no accents, numbers in a canonical form ("14.400" → "14400", "17,5" → "17.5", "150 – 180" → "150-180"). */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/(\d{1,3})(?:[.  ](\d{3}))+(?!\d)/g, (m) => m.replace(/[.  ]/g, ""))
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d)\s*[-–—]\s*(\d)/g, "$1-$2")
    .replace(/(\d)\s+%/g, "$1%")
    .replace(/\s+/g, " ")
    .trim();
}

const NUMBER_WORDS: Record<string, string> = { dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10" };
const DIGIT_WORDS = Object.fromEntries(Object.entries(NUMBER_WORDS).map(([w, d]) => [d, w]));

/** Equivalent phrasings: the generator may say "como mínimo" where the sheet said "al menos". */
export const QUANTIFIER_GROUPS = {
  min: ["al menos", "como minimo", "minimo de", "por lo menos"],
  max: ["como maximo", "no mas de", "maximo de", "como mucho"],
  only: ["exclusivamente", "unicamente", "solamente", "solo con", "solo los", "solo las"],
  not_reduce: ["sin reducir", "sin disminuir", "sin bajar"],
  own_words: ["sin copiar", "con tus palabras", "con tus propias palabras"],
  not_enough: ["no basta", "no es suficiente"],
  each: ["cada una", "cada uno"],
  // "*" = stem: "justifícalo", "justificando"…
  justify: ["justific*"],
} as const;

export const UNIT_GROUPS = {
  percent_points: ["puntos porcentuales", "punto porcentual", "p.p."],
  percent: ["%", "por ciento", "porcentaje"],
  words: ["palabras", "palabra"],
  lines: ["lineas", "linea", "renglones"],
  paragraphs: ["parrafos", "parrafo"],
  arguments: ["argumentos", "argumento"],
  data: ["datos numericos", "datos", "dato"],
  examples: ["ejemplos", "ejemplo"],
  euros: ["euros", "€"],
  inhabitants: ["habitantes"],
  tonnes: ["toneladas"],
  km: ["kilometros", "km"],
  meters: ["metros"],
  cm: ["centimetros", "cm"],
  mm: ["milimetros", "mm"],
  kg: ["kilogramos", "kg"],
  liters: ["litros"],
  degrees: ["grados"],
  minutes: ["minutos"],
  hours: ["horas"],
} as const;

export type CriticalToken =
  | { kind: "number"; value: string }
  | { kind: "quantifier"; group: keyof typeof QUANTIFIER_GROUPS }
  | { kind: "unit"; group: keyof typeof UNIT_GROUPS };

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasPhrase = (text: string, phrase: string) => {
  if (phrase === "%" || phrase === "€") return text.includes(phrase);
  if (phrase.endsWith("*")) return new RegExp(`(^|[^a-z0-9])${escape(phrase.slice(0, -1))}`).test(text);
  return new RegExp(`(^|[^a-z0-9])${escape(phrase)}([^a-z0-9]|$)`).test(text);
};

export function containsNumber(normalized: string, n: string): boolean {
  return new RegExp(`(^|[^0-9.])${n.replace(".", "\\.")}(?![0-9]|\\.[0-9])`).test(normalized);
}

/**
 * Tokens that must survive in an adapted activity: numbers and ranges, number words in front of a noun ("dos argumentos"),
 * quantifiers ("al menos", "sin reducir", "exclusivamente"…) and units. Order-preserving and without duplicates.
 */
export function criticalTokens(text: string): CriticalToken[] {
  const norm = normalizeText(text);
  const tokens: CriticalToken[] = [];
  const seen = new Set<string>();
  const push = (t: CriticalToken, key: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push(t);
    }
  };
  for (const m of norm.matchAll(/\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?(?:\/\d+)?/g)) push({ kind: "number", value: m[0] }, `n:${m[0]}`);
  for (const m of norm.matchAll(/(?:^|[^a-z])(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez) [a-z]/g)) {
    const value = NUMBER_WORDS[m[1]!]!;
    push({ kind: "number", value }, `n:${value}`);
  }
  for (const [group, phrases] of Object.entries(QUANTIFIER_GROUPS)) {
    if (phrases.some((p) => hasPhrase(norm, p))) push({ kind: "quantifier", group: group as keyof typeof QUANTIFIER_GROUPS }, `q:${group}`);
  }
  for (const [group, phrases] of Object.entries(UNIT_GROUPS)) {
    if (phrases.some((p) => hasPhrase(norm, p))) push({ kind: "unit", group: group as keyof typeof UNIT_GROUPS }, `u:${group}`);
  }
  return tokens;
}

/** Whether `text` still carries the token, accepting the equivalent forms ("dos" = "2", "como mínimo" = "al menos"). */
export function hasToken(text: string, token: CriticalToken): boolean {
  const norm = normalizeText(text);
  if (token.kind === "number") {
    if (containsNumber(norm, token.value)) return true;
    const word = DIGIT_WORDS[token.value];
    return word !== undefined && hasPhrase(norm, word);
  }
  if (token.kind === "quantifier") return QUANTIFIER_GROUPS[token.group].some((p) => hasPhrase(norm, p));
  return UNIT_GROUPS[token.group].some((p) => hasPhrase(norm, p));
}

/** Tokens of `text` that `reference` also contains: what an analyzer's paraphrase may require is only what the original says. */
export function sharedTokens(text: string, reference: string): CriticalToken[] {
  return criticalTokens(text).filter((t) => hasToken(reference, t));
}

export function describeToken(token: CriticalToken): string {
  if (token.kind === "number") return token.value;
  return (token.kind === "quantifier" ? QUANTIFIER_GROUPS[token.group][0] : UNIT_GROUPS[token.group][0]).replace("*", "");
}

/** Every number of a text, canonical (fractions included). */
export function numbersIn(text: string): string[] {
  return [...normalizeText(text).matchAll(/\d+\/\d+|\d+(?:\.\d+)?/g)].map((m) => m[0]);
}

/**
 * Traces of an answer that would give it away if they appeared in student-facing text: numbers and fractions that the
 * material itself does not contain (single digits only together with the word that follows them, "6 puntos"), or the whole
 * answer when it is a short phrase. Numbers already printed in the material are data, not a leak.
 */
export function answerSignatures(answer: string, materialNumbers: ReadonlySet<string>): string[] {
  const norm = normalizeText(answer);
  const signatures = new Set<string>();
  let numeric = false;
  for (const m of norm.matchAll(/\d+\/\d+|\d+(?:\.\d+)?/g)) {
    numeric = true;
    const n = m[0];
    if (materialNumbers.has(n)) continue;
    if (n.includes("/") || n.length >= 2 || n.includes(".")) signatures.add(n);
    else {
      const next = norm.slice((m.index ?? 0) + n.length).match(/^ ?([a-z]{3,}|%)/);
      if (next) signatures.add(next[1] === "%" ? `${n}%` : `${n} ${next[1]}`);
    }
  }
  if (!numeric) {
    const words = norm.split(" ");
    if (norm.length >= 5 && norm.length <= 60 && words.length <= 6) signatures.add(norm);
  }
  return [...signatures];
}

/** Whether a normalized student text contains one of the signatures. */
export function leakedSignature(studentText: string, signatures: readonly string[]): string | null {
  const norm = normalizeText(studentText);
  for (const s of signatures) {
    if (/^\d+(?:\.\d+)?$/.test(s) ? containsNumber(norm, s) : norm.includes(s)) return s;
  }
  return null;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Average words per sentence, for the reading-load check. */
export function averageSentenceLength(text: string): number {
  const sentences = text.split(/[.!?¿¡;:]+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length === 0) return 0;
  return sentences.reduce((sum, s) => sum + wordCount(s), 0) / sentences.length;
}
