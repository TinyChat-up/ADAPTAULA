/**
 * The analysis lists as an activity everything the student must answer (prompt material-analyzer v3: «todo lo que el alumno debe
 * resolver o responder»), so the parts of one exercise («3a», «b)», each true/false statement with its own letter) are separate
 * entries and the count can exceed the exercises the teacher sees on the sheet. The contract has no parent link; this groups the
 * entries by their printed label, deterministically and without changing the analysis:
 *   · «3», «3.», «Actividad 3», «Ejercicio 3» start activity 3; «3a», «3.b», «3 b)» are parts of activity 3;
 *   · a label that is only a letter or roman numeral («a)», «b.», «ii)») is a part of the activity just before it;
 *   · an entry without a label, or with any other label, stands on its own (never guessed into another activity).
 */
export interface ActivityGroup {
  /** «3», or the label as printed when it carries no number. */
  key: string;
  /** Ids of the entries in this group, in reading order: the first is the main one, the rest its parts. */
  ids: string[];
}

const NUMBERED = /^\s*(?:actividad|ejercicio|ej\.?|pregunta)?\s*(\d{1,3})\s*(?:[.)º:-])?\s*([a-z]|[ivx]{1,4})?\s*[).]?\s*$/i;
const PART_ONLY = /^\s*\(?([a-z]|[ivx]{1,4})\s*[).]\s*$/i;

export function groupActivities(activities: ReadonlyArray<{ id: string; label: string | null }>): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  let current: ActivityGroup | null = null;
  activities.forEach((a, index) => {
    const label = a.label?.trim() ?? "";
    const numbered = NUMBERED.exec(label);
    if (numbered) {
      const key = String(Number(numbered[1]));
      if (current && current.key === key) current.ids.push(a.id);
      else groups.push((current = { key, ids: [a.id] }));
      return;
    }
    if (current && PART_ONLY.test(label) && /^\d+$/.test(current.key)) {
      current.ids.push(a.id);
      return;
    }
    groups.push({ key: label || String(index + 1), ids: [a.id] });
    current = null;
  });
  return groups;
}

/** How a screen names the activity an entry belongs to: «la actividad 3». */
export function activityName(groups: readonly ActivityGroup[], id: string): string | null {
  const group = groups.find((g) => g.ids.includes(id));
  return group ? `la actividad ${group.key}` : null;
}
