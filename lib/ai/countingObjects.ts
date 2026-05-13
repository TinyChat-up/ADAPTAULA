// lib/ai/countingObjects.ts
export interface CountingObject {
  id: number;
  emoji: string;
  label: string;
}

export const COUNTING_OBJECTS: Record<string, CountingObject> = {
  pelota:     { id: 3241,  emoji: "⚽", label: "pelota" },
  manzana:    { id: 2462,  emoji: "🍎", label: "manzana" },
  libro:      { id: 25191, emoji: "📚", label: "libro" },
  lapiz:      { id: 2440,  emoji: "✏️", label: "lápiz" },
  flor:       { id: 7104,  emoji: "🌸", label: "flor" },
  estrella:   { id: 2752,  emoji: "⭐", label: "estrella" },
  arbol:      { id: 3057,  emoji: "🌳", label: "árbol" },
  casa:       { id: 6964,  emoji: "🏠", label: "casa" },
  perro:      { id: 7202,  emoji: "🐶", label: "perro" },
  gato:       { id: 7114,  emoji: "🐱", label: "gato" },
  pez:        { id: 2520,  emoji: "🐟", label: "pez" },
  coche:      { id: 2339,  emoji: "🚗", label: "coche" },
  globo:      { id: 2408,  emoji: "🎈", label: "globo" },
  sol:        { id: 7252,  emoji: "☀️", label: "sol" },
  luna:       { id: 2933,  emoji: "🌙", label: "luna" },
  mariposa:   { id: 26200, emoji: "🦋", label: "mariposa" },
  cohete:     { id: 2344,  emoji: "🚀", label: "cohete" },
  cuadrado:   { id: 4616,  emoji: "🟦", label: "cuadrado" },
  circulo:    { id: 4603,  emoji: "🔵", label: "círculo" },
  triangulo:  { id: 2604,  emoji: "🔺", label: "triángulo" },
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
