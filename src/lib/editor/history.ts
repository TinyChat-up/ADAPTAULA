export interface History<T> { past: T[]; present: T; future: T[] }
export const historyOf = <T>(value: T): History<T> => ({ past: [], present: value, future: [] });
export function changeHistory<T>(h: History<T>, value: T): History<T> {
  if (JSON.stringify(h.present) === JSON.stringify(value)) return h;
  return { past: [...h.past, h.present].slice(-50), present: value, future: [] };
}
export function undoHistory<T>(h: History<T>): History<T> {
  return h.past.length ? { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] } : h;
}
export function redoHistory<T>(h: History<T>): History<T> {
  return h.future.length ? { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) } : h;
}
