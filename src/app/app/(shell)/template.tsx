import type { ReactNode } from "react";

/**
 * Each section of the app enters with a short upward slide when the teacher moves to it (a template remounts on navigation; a
 * layout would not). Transform only: the text keeps its real contrast, and with `prefers-reduced-motion` it does not move.
 */
export default function ShellTemplate({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
