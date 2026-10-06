export interface SubjectOption {
  slug: string;
  name: string;
}

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Maps a free-text subject ("Lengua", "Matemáticas") to a catalog slug. Exact matches win;
 * a partial match is accepted only when it points to a single subject. Unknown or ambiguous → null.
 */
export function matchSubjectSlug(text: string, subjects: readonly SubjectOption[]): string | null {
  const wanted = normalize(text);
  if (wanted.length < 3) return null;

  const exact = subjects.filter((s) => normalize(s.name) === wanted || s.slug === wanted);
  if (exact.length === 1) return exact[0]!.slug;

  const partial = subjects.filter((s) => {
    if (s.slug === "otra") return false;
    const name = normalize(s.name);
    return name.includes(wanted) || (name.length >= 4 && wanted.includes(name));
  });
  return partial.length === 1 ? partial[0]!.slug : null;
}
