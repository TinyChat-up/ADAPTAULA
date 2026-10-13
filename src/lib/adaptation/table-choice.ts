import { MaterialAnalysisSchema, type AnalysisActivity, type AnalysisVisual } from "@/lib/schemas/material-analysis";
import { fingerprint } from "./fingerprint";
import { singleChoiceStructureViolations, sourceSingleChoice } from "./single-choice";

export const ChoiceTableSchema = MaterialAnalysisSchema.shape.visuals.element.shape.table.unwrap().strict();
export type ChoiceTable = NonNullable<AnalysisVisual["table"]>;
export interface TableEvidence { method: "pdf_grid_text_v1"; sourceSha256: string; page: number; tableSha256: string }
export const tableText = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ");
const key = (s: string) => tableText(s).toLocaleLowerCase("es");

export function usableChoiceTable(table: ChoiceTable): boolean {
  const cells = [table.headers, ...table.rows];
  return table.unit === null && table.headers.length >= 2 && table.headers.length <= 6 && table.rows.length >= 1 && table.rows.length <= 12
    && cells.every((r) => r.length === table.headers.length && r.every((c) => tableText(c).length > 0))
    && new Set(table.headers.map(key)).size === table.headers.length && new Set(table.rows.map((r) => key(r[0]!))).size === table.rows.length;
}

export const tableEvidenceMatches = (visual: AnalysisVisual, evidence: TableEvidence | null | undefined): evidence is TableEvidence => Boolean(visual.table && evidence?.method === "pdf_grid_text_v1" && /^[a-f0-9]{64}$/.test(evidence.sourceSha256) && evidence.page === visual.page && evidence.tableSha256 === fingerprint(visual.table));

/** First column identifies rows. Only an explicit lookup in one named column is proven; no inference, comparison or aggregation. */
export function tableChoiceViolations(activity: AnalysisActivity, visual: AnalysisVisual, candidate: { prompt: string; steps: string[]; lines: number; choice: unknown; table: unknown; figure: unknown }, evidence?: TableEvidence): string[] {
  const source = sourceSingleChoice(activity);
  const table = visual.table;
  if (!source || !table || !usableChoiceTable(table)) return ["table_source_unverifiable"];
  if (!tableEvidenceMatches(visual, evidence)) return ["table_uncorroborated"];
  const violations = singleChoiceStructureViolations(source, candidate);
  const parsed = ChoiceTableSchema.safeParse(candidate.table);
  if (!parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(table)) violations.push("table_data_changed");
  if (candidate.figure !== null) violations.push("table_answer_support");
  const matches: Array<{ row: number; column: number }> = [];
  for (let r = 0; r < table.rows.length; r++) for (let c = 1; c < table.headers.length; c++) {
    const question = `Según la tabla, ¿qué ${table.headers[c]} corresponde a «${table.rows[r]![0]}»? Elige una opción.`;
    if (key(source.prompt) === key(question)) matches.push({ row: r, column: c });
  }
  if (matches.length !== 1) return [...violations, "table_reference_unverifiable"];
  const { row, column } = matches[0]!;
  const value = key(table.rows[row]![column]!);
  const optionValues = source.response.options.map((o) => key(o.text.replace(/^[a-h][).]\s+/i, "")));
  // A closed vocabulary of literal text cells: no invented synonyms, unit conversions or numeric equivalences.
  const columnValues = table.rows.map((r) => key(r[column]!));
  if (optionValues.some((v) => /\p{N}/u.test(v) || !columnValues.includes(v))) violations.push("table_reference_unverifiable");
  const correct = optionValues.flatMap((v, i) => v === value ? [i] : []);
  if (correct.length !== 1) violations.push("choice_correct_count");
  const answer = key(activity.expected_answer.value ?? "");
  const letter = /^(?:opción )?([a-h])[).]?$/.exec(answer);
  const byText = optionValues.flatMap((v, i) => v === answer ? [i] : []);
  const expected = letter ? letter[1]!.charCodeAt(0) - 97 : byText.length === 1 ? byText[0]! : -1;
  if (activity.expected_answer.basis !== "source" || expected < 0 || expected >= optionValues.length) violations.push("choice_key_unverifiable");
  else if (correct.length === 1 && correct[0] !== expected) violations.push("choice_answer_changed");
  return violations;
}
