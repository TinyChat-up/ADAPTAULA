export interface CatalogStage {
  slug: string;
  name: string;
}
export interface CatalogGrade {
  slug: string;
  stage_slug: string;
  name: string;
}
export interface EducationCatalog {
  stages: CatalogStage[];
  grades: CatalogGrade[];
}

/** The grade must exist and belong to the chosen stage (the DB only guarantees each exists on its own). */
export function isValidStageGrade(catalog: EducationCatalog, stageSlug: string, gradeSlug: string): boolean {
  return (
    catalog.stages.some((s) => s.slug === stageSlug) &&
    catalog.grades.some((g) => g.slug === gradeSlug && g.stage_slug === stageSlug)
  );
}

export function labelsFor(catalog: EducationCatalog, stageSlug: string | null, gradeSlug: string | null) {
  return {
    stage: catalog.stages.find((s) => s.slug === stageSlug)?.name ?? null,
    grade: catalog.grades.find((g) => g.slug === gradeSlug)?.name ?? null,
  };
}
