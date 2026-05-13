// lib/ai/countingObjects.ts
export interface CountingObject {
  id: number;
  emoji: string;
  label: string;
}

export const COUNTING_OBJECTS: Record<string, CountingObject> = {
  pelota:     { id: 6802,  emoji: "⚽", label: "pelota" },
  manzana:    { id: 4580,  emoji: "🍎", label: "manzana" },
  libro:      { id: 6504,  emoji: "📚", label: "libro" },
  lapiz:      { id: 6479,  emoji: "✏️", label: "lápiz" },
  flor:       { id: 3582,  emoji: "🌸", label: "flor" },
  estrella:   { id: 3553,  emoji: "⭐", label: "estrella" },
  arbol:      { id: 4526,  emoji: "🌳", label: "árbol" },
  casa:       { id: 3050,  emoji: "🏠", label: "casa" },
  perro:      { id: 7328,  emoji: "🐶", label: "perro" },
  gato:       { id: 3653,  emoji: "🐱", label: "gato" },
  pez:        { id: 7319,  emoji: "🐟", label: "pez" },
  coche:      { id: 3108,  emoji: "🚗", label: "coche" },
  globo:      { id: 3630,  emoji: "🎈", label: "globo" },
  sol:        { id: 7683,  emoji: "☀️", label: "sol" },
  luna:       { id: 6558,  emoji: "🌙", label: "luna" },
  mariposa:   { id: 6590,  emoji: "🦋", label: "mariposa" },
  cohete:     { id: 3165,  emoji: "🚀", label: "cohete" },
  cuadrado:   { id: 3228,  emoji: "🟦", label: "cuadrado" },
  circulo:    { id: 3153,  emoji: "🔵", label: "círculo" },
  triangulo:  { id: 7893,  emoji: "🔺", label: "triángulo" },
};

export function getArasaacUrl(id: number): string {
  return `https://static.arasaac.org/pictograms/${id}/${id}_500.png`;
}

export function buildCountGroupHtml(
  objectKey: string,
  count: number
): string {
  const obj = COUNTING_OBJECTS[objectKey];
  if (!obj) return "";
  const url = getArasaacUrl(obj.id);
  const items = Array.from({ length: count }, () =>
    `<div class="aa-count-item"><img class="aa-count-img" src="${url}" alt="${obj.label}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><span class="aa-count-emoji" style="display:none">${obj.emoji}</span></div>`
  ).join("");
  return `<div class="aa-count-group">${items}</div>`;
}

export function buildColorGridHtml(total: number, target: number): string {
  const cells = Array.from({ length: total }, (_, i) =>
    `<div class="aa-color-cell${i < target ? " aa-color-cell--example" : ""}"></div>`
  ).join("");
  return `<div class="aa-color-grid">${cells}</div>`;
}
