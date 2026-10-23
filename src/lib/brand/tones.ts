/**
 * The colours of «aula» in the official wordmark, in their order (orange, green, blue, cyan), as the tones of a numbered sequence:
 * the steps of the process speak the brand. Accessible variants (docs/BRAND.md §3): «-ink» text reaches 4.5:1 and «-ui» rules 3:1
 * on the app surfaces. The number is never the only carrier of the step: its title and its order say it too.
 */
const TONES = [
  { text: "text-brand-orange-ink", rule: "border-brand-orange-ui" },
  { text: "text-brand-green-ink", rule: "border-brand-green-ui" },
  { text: "text-brand-blue-ink", rule: "border-brand-blue" },
  { text: "text-brand-cyan-ink", rule: "border-brand-cyan-ui" },
  { text: "text-primary", rule: "border-primary" },
] as const;

export const stepTone = (index: number) => TONES[index % TONES.length]!;
