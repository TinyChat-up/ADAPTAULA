/**
 * The small subset of LaTeX the sheet can compose without a math engine: numbers, letters, the usual operators and
 * `\frac{a}{b}` with plain numerator and denominator (what school fractions need). Anything else returns null and the formula is
 * shown as its source with its spoken text, as before. Text only: never HTML.
 */
export type MathPart = { kind: "text"; text: string } | { kind: "frac"; num: string; den: string };

const SYMBOLS: Record<string, string> = { "\\times": "×", "\\cdot": "·", "\\div": "÷", "\\pm": "±", "\\le": "≤", "\\ge": "≥", "\\neq": "≠" };
const PLAIN = /^[0-9A-Za-z+\-=()., ]*$/;

export function composeMath(latex: string): MathPart[] | null {
  const parts: MathPart[] = [];
  let rest = latex.trim();
  const text = (t: string) => {
    if (!t) return;
    const last = parts.at(-1);
    if (last?.kind === "text") last.text += t;
    else parts.push({ kind: "text", text: t });
  };
  const plain = (t: string) => {
    let out = t;
    for (const [cmd, sym] of Object.entries(SYMBOLS)) out = out.split(cmd).join(sym);
    const check = out.replace(/[×·÷±≤≥≠]/g, "");
    return PLAIN.test(check) ? out : null;
  };
  while (rest.length > 0) {
    const frac = /^\\frac\{([^{}]{1,40})\}\{([^{}]{1,40})\}/.exec(rest);
    if (frac) {
      const num = plain(frac[1]!);
      const den = plain(frac[2]!);
      if (num === null || den === null) return null;
      parts.push({ kind: "frac", num: num.trim(), den: den.trim() });
      rest = rest.slice(frac[0].length);
      continue;
    }
    const next = rest.search(/\\frac\{/);
    const chunk = next === -1 ? rest : rest.slice(0, next);
    const converted = plain(chunk);
    if (converted === null || chunk.length === 0) return null;
    text(converted.replace(/\s*([=+×·÷−-])\s*/g, " $1 "));
    rest = rest.slice(chunk.length);
  }
  return parts.some((p) => p.kind === "frac") || parts.length > 0 ? parts : null;
}
