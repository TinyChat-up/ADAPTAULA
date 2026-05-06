"use client";
import { useState } from "react";

const TAGS = [
  "Lenguaje demasiado difícil",
  "Falta estructura visual",
  "Pictogramas incorrectos",
  "Contenido sin sentido",
  "Demasiado corto",
];

interface Props {
  adaptationId?: string | null;
  subject?: string;
  supportDegree?: string;
  learningProfile?: string;
  token?: string | null;
}

export default function FeedbackWidget({ adaptationId, subject, supportDegree, learningProfile, token }: Props) {
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const toggleTag = (tag: string) =>
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : prev.length < 3 ? [...prev, tag] : prev
    );

  const submit = async (r: 1 | -1) => {
    setSending(true);
    await fetch("/api/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        rating: r,
        tags,
        comment: comment.trim() || undefined,
        adaptationId,
        subject,
        supportDegree,
        learningProfile,
      }),
    });
    setSent(true);
    setSending(false);
  };

  if (sent) {
    return (
      <div className="mx-auto mt-4" style={{ maxWidth: 820 }}>
        <div
          className="rounded-2xl bg-white px-5 py-4 text-center text-sm"
          style={{ border: "1px solid #E8E5E0", color: "#4A7C59", fontWeight: 600 }}
        >
          ¡Gracias por tu valoración! Nos ayuda a mejorar AdaptAula. 🎉
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-4" style={{ maxWidth: 820 }}>
      <div
        className="rounded-2xl bg-white px-5 py-4"
        style={{ border: "1px solid #E8E5E0", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
      >
        <p className="mb-3 text-sm font-semibold" style={{ color: "#374151" }}>
          ¿Cómo ha quedado la adaptación?
        </p>

        {/* Thumbs */}
        {rating === null && (
          <div className="flex gap-3">
            <button
              type="button"
              disabled={sending}
              onClick={() => { setRating(1); void submit(1); }}
              className="flex items-center gap-2 rounded-xl border-2 px-4 py-2 text-sm font-semibold transition-all hover:bg-green-50"
              style={{ borderColor: "#4A7C59", color: "#4A7C59" }}
            >
              👍 Funciona bien
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={() => setRating(-1)}
              className="flex items-center gap-2 rounded-xl border-2 px-4 py-2 text-sm font-semibold transition-all hover:bg-red-50"
              style={{ borderColor: "#E8842A", color: "#E8842A" }}
            >
              👎 Hay problemas
            </button>
          </div>
        )}

        {/* Tags (only on thumbs down) */}
        {rating === -1 && (
          <div>
            <p className="mb-2 text-xs" style={{ color: "#6B7280" }}>
              ¿Qué ha fallado? (máx. 3)
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
              {TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className="rounded-full px-3 py-1 text-xs font-medium transition-all"
                  style={{
                    background: tags.includes(tag) ? "#E8842A" : "#F3F4F6",
                    color: tags.includes(tag) ? "white" : "#374151",
                    border: "1.5px solid",
                    borderColor: tags.includes(tag) ? "#E8842A" : "#E5E7EB",
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Cuéntanos más (opcional)..."
              rows={2}
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-orange-400"
              style={{ borderColor: "#E5E7EB", resize: "none", color: "#374151" }}
            />
            <button
              type="button"
              disabled={sending}
              onClick={() => void submit(-1)}
              className="mt-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: "#4A7C59" }}
            >
              {sending ? "Enviando…" : "Enviar valoración"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
