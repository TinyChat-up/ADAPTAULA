import type { ReactNode } from "react";

export function WorkspaceDisclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="workspace-disclosure">
      <summary>{title}</summary>
      <div className="space-y-5 pb-4 pt-2">{children}</div>
    </details>
  );
}
