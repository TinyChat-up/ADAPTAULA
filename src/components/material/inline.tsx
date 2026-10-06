import type { Run } from "@/lib/render/inline";

export function Runs({ runs }: { runs: readonly Run[] }) {
  return (
    <>
      {runs.map((r, i) => (r.bold ? <strong key={i}>{r.text}</strong> : r.italic ? <em key={i}>{r.text}</em> : <span key={i}>{r.text}</span>))}
    </>
  );
}

export function Paragraphs({ paragraphs, className }: { paragraphs: readonly Run[][]; className?: string }) {
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className={className}>
          <Runs runs={p} />
        </p>
      ))}
    </>
  );
}
