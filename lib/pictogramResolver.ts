// lib/pictogramResolver.ts
// Integración con la API pública y gratuita de ARASAAC
// https://arasaac.org/developers/api — no requiere API key

export interface PictogramResult {
  id: number;
  word: string;
  imageUrl: string;
}

/** Busca un pictograma en ARASAAC por palabra en español */
export async function searchPictogram(word: string): Promise<PictogramResult | null> {
  try {
    const url = `https://api.arasaac.org/v1/pictograms/es/search/${encodeURIComponent(word)}`;
    const response = await fetch(url, { next: { revalidate: 86400 } }); // cache 24h
    if (!response.ok) return null;
    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) return null;
    const best = results[0];
    return {
      id: best._id,
      word,
      imageUrl: `https://static.arasaac.org/pictograms/${best._id}/${best._id}_500.png`,
    };
  } catch {
    return null;
  }
}

/** Resuelve un array de palabras clave en paralelo (lotes de 5) */
export async function resolvePictograms(
  keywords: string[],
): Promise<Record<string, PictogramResult>> {
  const results: Record<string, PictogramResult> = {};
  const batchSize = 5;
  for (let i = 0; i < keywords.length; i += batchSize) {
    const batch = keywords.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map((w) => searchPictogram(w)));
    batchResults.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value) {
        results[batch[index]] = result.value;
      }
    });
    if (i + batchSize < keywords.length) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return results;
}

/** Genera el bloque de texto con los pictogramas resueltos para inyectar en el prompt */
export function buildPictogramSuggestions(
  resolved: Record<string, PictogramResult>,
): string {
  const entries = Object.entries(resolved);
  if (entries.length === 0) {
    return "No se encontraron pictogramas. Genera el documento sin ellos.";
  }
  return entries
    .map(([word, p]) => `- "${word}" → <img class="aa-picto" src="${p.imageUrl}" alt="${word}" />`)
    .join("\n");
}

const MATH_ABSTRACT_BLACKLIST = new Set([
  // Términos matemáticos abstractos
  "grado", "segundo", "primer", "sistema", "sistemas", "ecuacion", "ecuaciones",
  "operacion", "operaciones", "resultado", "datos", "formula", "incognita",
  "variable", "numero", "numeros", "calculo", "algebra", "factorizacion",
  "discriminante", "solucion", "soluciones", "expresion", "termino",
  "coeficiente", "polinomio", "raiz", "raices", "valor", "valores",
  "suma", "resta", "multiplicacion", "division", "fraccion", "decimal",
  "potencia", "cuadrado", "cuadrada", "rectangulo", "triangulo", "angulo",
  "medida", "longitud", "perimetro", "area", "volumen", "proporcion",
  // Términos de instrucción abstractos
  "recordatorio", "checklist", "ejercicio", "ejercicios", "actividad",
  "ejemplo", "comprobacion", "resolucion", "presentacion", "orden",
  "forma", "formas", "tipo", "tipos", "paso", "pasos", "proceso",
  "metodo", "tecnica", "estrategia", "objetivo", "material",
  // Palabras funcionales y verbos de instrucción abstractos
  "simplifica", "despeja", "sustituye", "calcula", "resuelve",
  "traduce", "escribe", "encuentra", "busca", "completa", "marca",
  "relaciona", "ordena", "clasifica", "compara", "analiza",
]);

/** Normaliza una palabra: minúsculas y sin tildes */
function normalize(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Extrae palabras clave del texto para buscar pictogramas */
export function extractKeywordsForPictograms(
  sourceText: string,
  config: { supportLevel: string; subject?: string },
): string[] {
  const stopWords = new Set([
    "el", "la", "los", "las", "un", "una", "unos", "unas",
    "de", "del", "al", "en", "con", "por", "para", "que",
    "es", "son", "esta", "estan", "tiene", "tienen", "hay",
    "y", "o", "pero", "si", "no", "se", "le", "les", "mas",
    "como", "este", "estos", "estas", "sus", "ser",
  ]);

  const words = sourceText
    .toLowerCase()
    .replace(/[^\wáéíóúüñ\s]/g, " ")
    .split(/\s+/)
    .filter((w) => {
      if (w.length < 4) return false;
      const n = normalize(w);
      if (stopWords.has(n)) return false;
      if (MATH_ABSTRACT_BLACKLIST.has(n)) return false;
      // Remove numbers and words containing numbers
      if (/\d/.test(w)) return false;
      // Remove words with mathematical symbols
      if (/[xy²+\-=]/.test(w)) return false;
      return true;
    });

  const unique = [...new Set(words)];

  // Extra strict filtering for mathematics: only concrete real-world nouns
  if (config.subject === "matematicas") {
    const concrete = unique.filter((w) => {
      const n = normalize(w);
      // Skip anything in the blacklist (already filtered above, but be explicit)
      if (MATH_ABSTRACT_BLACKLIST.has(n)) return false;
      // Skip action verbs (common Spanish verb endings)
      if (/[aeiou]r$/.test(n)) return false;       // infinitives
      if (/(ando|iendo|ado|ido|amos|emos|imos|ando|iendo)$/.test(n)) return false;
      // Skip abstract noun endings
      if (/(cion|sion|dad|ismo|eza|ura|miento|ncia|idad)$/.test(n)) return false;
      return true;
    });
    const max = config.supportLevel === "alto" ? 8 : config.supportLevel === "medio" ? 4 : 2;
    return concrete.slice(0, max);
  }

  const max = config.supportLevel === "alto" ? 12 : config.supportLevel === "medio" ? 7 : 4;
  return unique.slice(0, max);
}
