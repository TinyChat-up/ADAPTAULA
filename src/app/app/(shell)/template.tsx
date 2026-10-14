import type { ReactNode } from "react";

/** Keep the existing route boundary; navigation does not animate the page content. */
export default function ShellTemplate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
