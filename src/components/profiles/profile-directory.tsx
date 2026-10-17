"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/fields";
import { formatDay } from "@/lib/format/date";

export interface ProfileDirectoryItem {
  id: string;
  name: string;
  grade: string;
  stage: string;
  gradeSlug: string;
  summary: string;
  updatedAt: string;
}

export function ProfileDirectory({ items }: { items: ProfileDirectoryItem[] }) {
  const [search, setSearch] = useState("");
  const [grade, setGrade] = useState("");
  const filtered = items.filter((p) => p.name.toLocaleLowerCase("es").includes(search.trim().toLocaleLowerCase("es")) && (!grade || p.gradeSlug === grade));
  const grades = Array.from(new Map(items.filter((p) => p.gradeSlug).map((p) => [p.gradeSlug, p.grade])).entries());
  return (
    <section aria-label="Perfiles guardados" className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TextField label="Buscar por alias" value={search} onChange={(e) => setSearch(e.target.value)} type="search" maxLength={60} />
        <SelectField label="Filtrar por curso" value={grade} onChange={(e) => setGrade(e.target.value)}>
          <option value="">Todos los cursos</option>
          {grades.map(([slug, label]) => <option key={slug} value={slug}>{label}</option>)}
        </SelectField>
      </div>
      <p role="status" className="text-sm text-muted-foreground">{filtered.length} {filtered.length === 1 ? "perfil" : "perfiles"} · Actualizados más recientemente primero</p>
      {filtered.length === 0 ? (
        <div className="space-y-3 border-t border-border py-6">
          <p>No hay perfiles que coincidan con tu búsqueda.</p>
          <Button variant="secondary" onClick={() => { setSearch(""); setGrade(""); }}>Limpiar filtros</Button>
        </div>
      ) : (
        <ul className="editorial-list">
          {filtered.map((p) => (
            <li key={p.id}>
              <Link href={`/app/alumnos/${p.id}`} className="group block space-y-2 py-5 transition-colors hover:bg-surface/60">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="min-w-0 break-words text-lg font-semibold">{p.name}</span>
                  <span className="text-sm text-muted-foreground">{[p.stage, p.grade].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="block text-sm text-muted-foreground">{p.summary}</span>
                <span className="flex flex-wrap justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Actualizado el {formatDay(p.updatedAt)}</span>
                  <span className="font-medium text-primary">Abrir perfil →</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
