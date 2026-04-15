"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeOutputFormat } from "@/lib/document-format";

type DocumentCanvasProps = {
  html: string;
  compact?: boolean;
  outputFormat?: string;
  isGenerating?: boolean;
  revealKey?: number;
};

function WritingSkeleton() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-5 overflow-hidden rounded-[30px] bg-white px-16 py-14 lg:px-20 lg:py-16">
      {/* Title line with typing cursor */}
      <div className="flex items-center gap-2">
        <div className="h-8 w-2/3 animate-[skeletonType_2.8s_ease-in-out_infinite] rounded-lg bg-gradient-to-r from-emerald-100 via-emerald-50 to-slate-100" />
        <span className="h-7 w-0.5 animate-[blink_1s_step-end_infinite] bg-emerald-600" />
      </div>
      {/* Instruction box */}
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
        <div className="h-3.5 w-1/2 animate-[skeletonFill_1.8s_ease-in-out_0.3s_infinite] rounded-md bg-emerald-200/70" />
        <div className="mt-3 h-3 w-4/5 animate-[skeletonFill_1.8s_ease-in-out_0.5s_infinite] rounded-md bg-emerald-100" />
        <div className="mt-2 h-3 w-3/5 animate-[skeletonFill_1.8s_ease-in-out_0.7s_infinite] rounded-md bg-emerald-100" />
      </div>
      {/* Activity cards appearing one by one */}
      {[0.9, 1.6, 2.3].map((delay, i) => (
        <div
          key={i}
          className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4"
          style={{ animationDelay: `${delay}s` }}
        >
          <div
            className="h-3.5 w-1/3 animate-[skeletonFill_2s_ease-in-out_infinite] rounded-md bg-slate-300/60"
            style={{ animationDelay: `${delay}s` }}
          />
          <div
            className="mt-3 h-3 w-full animate-[skeletonFill_2s_ease-in-out_infinite] rounded-md bg-slate-200"
            style={{ animationDelay: `${delay + 0.15}s` }}
          />
          <div
            className="mt-2 h-3 w-3/4 animate-[skeletonFill_2s_ease-in-out_infinite] rounded-md bg-slate-200"
            style={{ animationDelay: `${delay + 0.3}s` }}
          />
          <div className="mt-4 h-20 rounded-xl border border-slate-200 bg-white" />
        </div>
      ))}
      <style jsx global>{`
        @keyframes skeletonType {
          0%, 100% { width: 20%; opacity: 0.5; }
          60% { width: 66%; opacity: 1; }
        }
        @keyframes skeletonFill {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function injectDocumentStyles(html: string): string {
  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/i);
  if (!styleMatch) return html;

  const existingStyle = document.getElementById("aa-document-styles");
  if (existingStyle) existingStyle.remove();

  const styleEl = document.createElement("style");
  styleEl.id = "aa-document-styles";
  styleEl.textContent = styleMatch[1];
  document.head.appendChild(styleEl);

  return html.replace(/<style>[\s\S]*?<\/style>/i, "").trim();
}

export default function DocumentCanvas({
  html,
  compact = false,
  outputFormat = "Ficha de trabajo",
  isGenerating = false,
  revealKey = 0,
}: DocumentCanvasProps) {
  const format = normalizeOutputFormat(outputFormat);
  const articleRef = useRef<HTMLElement>(null);
  const prevKeyRef = useRef(revealKey);
  const [revealing, setRevealing] = useState(false);
  const [cleanHtml, setCleanHtml] = useState(html);

  useEffect(() => {
    setCleanHtml(injectDocumentStyles(html));
  }, [html]);

  useEffect(() => {
    if (revealKey === 0 || revealKey === prevKeyRef.current) return;
    prevKeyRef.current = revealKey;
    setRevealing(true);
    const t = setTimeout(() => setRevealing(false), 3200);
    return () => clearTimeout(t);
  }, [revealKey]);
  const enhancedHtml = useMemo(() => {
    const base = cleanHtml?.trim() || "";
    if (!base) return "<h1>Ficha adaptada</h1><p>Sin contenido.</p>";
    if (typeof window === "undefined" || typeof DOMParser === "undefined") {
      return base;
    }
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div id="aa-root">${base}</div>`, "text/html");
      const root = doc.getElementById("aa-root");
      if (!root) return base;

      if (!root.querySelector("h1")) {
        const h1 = doc.createElement("h1");
        h1.textContent = "Ficha adaptada";
        root.prepend(h1);
      }
      if (!root.querySelector('[data-aa-role="worksheet-body"]')) {
        const body = doc.createElement("section");
        body.setAttribute("data-aa-role", "worksheet-body");
        const toMove = Array.from(root.childNodes).filter((node) => {
          if (!(node instanceof HTMLElement)) return true;
          return node.tagName.toLowerCase() !== "h1";
        });
        toMove.forEach((node) => body.appendChild(node));
        root.appendChild(body);
      }

      const firstParagraph = root.querySelector("p");
      if (
        firstParagraph &&
        !root.querySelector('[data-aa-role="instructions"]') &&
        (firstParagraph.textContent || "").trim().length <= 280
      ) {
        firstParagraph.setAttribute("data-aa-role", "instructions");
      }

      root.querySelectorAll("h2, h3").forEach((heading) => {
        if (!heading.getAttribute("data-aa-role")) {
          heading.setAttribute("data-aa-role", "worksheet-section-title");
        }
      });

      root.querySelectorAll("li").forEach((item) => {
        if (!item.getAttribute("data-aa-role")) {
          item.setAttribute("data-aa-role", "worksheet-question");
        }
      });

      root.querySelectorAll("li").forEach((item) => {
        if (!item.querySelector('[data-aa-role="response-lines"], [data-aa-role="response-box"]')) {
          const text = (item.textContent || "").trim();
          if (text.length > 6) {
            const response = doc.createElement("div");
            response.setAttribute("data-aa-role", "response-lines");
            response.setAttribute("data-aa-lines", "3");
            item.appendChild(response);
          }
        }
      });

      root.querySelectorAll("p").forEach((paragraph) => {
        if (
          paragraph.getAttribute("data-aa-role") ||
          paragraph.closest('[data-aa-role="instructions"]') ||
          paragraph.closest("li")
        ) {
          return;
        }
        const text = (paragraph.textContent || "").trim();
        if (!text || text.length < 12) return;
        const looksLikeInstruction =
          /\?$/.test(text) ||
          /^(escribe|completa|rodea|subraya|observa|responde|ordena|calcula)\b/i.test(text);
        if (looksLikeInstruction) {
          paragraph.setAttribute("data-aa-role", "worksheet-question");
          if (!paragraph.nextElementSibling?.matches('[data-aa-role="response-lines"],[data-aa-role="response-box"]')) {
            const response = doc.createElement("div");
            response.setAttribute("data-aa-role", "response-lines");
            response.setAttribute("data-aa-lines", "3");
            paragraph.after(response);
          }
        }
      });

      const worksheetBody =
        root.querySelector('[data-aa-role="worksheet-body"]') || root;
      const topLevel = Array.from(worksheetBody.children);
      const printableBlocks = topLevel.filter((node) => {
        if (!(node instanceof HTMLElement)) return false;
        const tag = node.tagName.toLowerCase();
        if (tag === "h1") return false;
        return (
          tag === "h2" ||
          tag === "h3" ||
          tag === "p" ||
          tag === "ul" ||
          tag === "ol" ||
          node.hasAttribute("data-aa-role")
        );
      });

      if (
        !worksheetBody.querySelector('[data-aa-role="activities"]') &&
        printableBlocks.length > 0
      ) {
        const activities = doc.createElement("section");
        activities.setAttribute("data-aa-role", "activities");

        printableBlocks.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.getAttribute("data-aa-role") === "instructions") return;
          const tag = node.tagName.toLowerCase();
          if (tag === "h2" || tag === "h3") {
            activities.appendChild(node);
            return;
          }
          if (tag === "ul" || tag === "ol") {
            node.querySelectorAll(":scope > li").forEach((li) => {
              const card = doc.createElement("article");
              card.setAttribute("data-aa-role", "activity-card");
              const question = doc.createElement("div");
              question.setAttribute("data-aa-role", "worksheet-question");
              question.innerHTML = li.innerHTML;
              card.appendChild(question);
              if (!question.querySelector('[data-aa-role="response-lines"],[data-aa-role="response-box"]')) {
                const response = doc.createElement("div");
                response.setAttribute("data-aa-role", "response-lines");
                response.setAttribute("data-aa-lines", "3");
                card.appendChild(response);
              }
              activities.appendChild(card);
            });
            node.remove();
            return;
          }
          if (node.getAttribute("data-aa-role") === "worksheet-question") {
            const card = doc.createElement("article");
            card.setAttribute("data-aa-role", "activity-card");
            card.appendChild(node);
            if (!card.querySelector('[data-aa-role="response-lines"],[data-aa-role="response-box"]')) {
              const response = doc.createElement("div");
              response.setAttribute("data-aa-role", "response-lines");
              response.setAttribute("data-aa-lines", "3");
              card.appendChild(response);
            }
            activities.appendChild(card);
            return;
          }
          activities.appendChild(node);
        });

        worksheetBody.appendChild(activities);
      }

      worksheetBody
        .querySelectorAll<HTMLElement>('[data-aa-role="activity-card"]')
        .forEach((card) => {
          if (card.querySelector('[data-aa-role="pictogram-strip"]')) return;
          const pictogramWrappers = Array.from(
            card.querySelectorAll<HTMLElement>('span[data-aa-picto], [data-aa-role="pictogram-card"]'),
          );
          if (pictogramWrappers.length === 0) return;

          const strip = doc.createElement("div");
          strip.setAttribute("data-aa-role", "pictogram-strip");

          pictogramWrappers.slice(0, 8).forEach((wrapper) => {
            const cardItem = doc.createElement("div");
            cardItem.setAttribute("data-aa-role", "pictogram-card");
            const image =
              wrapper.querySelector<HTMLImageElement>('img[data-aa-pictogram], img') ||
              null;
            const concept =
              wrapper.getAttribute("data-aa-concept") ||
              wrapper
                .querySelector('[data-aa-role="pictogram-word"]')
                ?.textContent?.trim() ||
              wrapper.textContent?.trim() ||
              "concepto";
            if (image) {
              const clone = image.cloneNode(true) as HTMLImageElement;
              clone.removeAttribute("width");
              clone.removeAttribute("height");
              clone.setAttribute("data-aa-pictogram", "1");
              cardItem.appendChild(clone);
            }
            const label = doc.createElement("span");
            label.setAttribute("data-aa-role", "pictogram-word");
            label.textContent = concept;
            cardItem.appendChild(label);
            strip.appendChild(cardItem);
            wrapper.remove();
          });

          card.prepend(strip);
      });

      const allInlinePictos = Array.from(
        worksheetBody.querySelectorAll<HTMLElement>('span[data-aa-picto]'),
      );
      if (allInlinePictos.length > 0) {
        let board =
          worksheetBody.querySelector<HTMLElement>('[data-aa-role="pictogram-grid"]');
        if (!board) {
          const boardWrapper = doc.createElement("section");
          boardWrapper.setAttribute("data-aa-pictogram-board", "1");
          boardWrapper.setAttribute("data-aa-level", "alto");
          const title = doc.createElement("h3");
          title.textContent = "Apoyos visuales";
          board = doc.createElement("div");
          board.setAttribute("data-aa-role", "pictogram-grid");
          boardWrapper.appendChild(title);
          boardWrapper.appendChild(board);
          worksheetBody.prepend(boardWrapper);
        }

        allInlinePictos.slice(0, 24).forEach((wrapper) => {
          const concept =
            wrapper.getAttribute("data-aa-concept") ||
            wrapper.textContent?.trim() ||
            "concepto";
          const image = wrapper.querySelector<HTMLImageElement>("img");
          const cardItem = doc.createElement("div");
          cardItem.setAttribute("data-aa-role", "pictogram-card");
          if (image) {
            const clone = image.cloneNode(true) as HTMLImageElement;
            clone.setAttribute("data-aa-pictogram", "1");
            cardItem.appendChild(clone);
          }
          const label = doc.createElement("span");
          label.setAttribute("data-aa-role", "pictogram-word");
          label.textContent = concept;
          cardItem.appendChild(label);
          board?.appendChild(cardItem);
          wrapper.remove();
        });
      }

      worksheetBody.querySelectorAll("p,li").forEach((node) => {
        const el = node as HTMLElement;
        if (
          el.querySelector('img[data-aa-pictogram]') &&
          !el.getAttribute("data-aa-role")
        ) {
          el.setAttribute("data-aa-role", "pictogram-text-block");
        }
      });

      if (!worksheetBody.querySelector('[data-aa-role="worksheet-footer"]')) {
        const footer = doc.createElement("div");
        footer.setAttribute("data-aa-role", "worksheet-footer");
        footer.textContent = "Revisa tus respuestas antes de entregar.";
        worksheetBody.appendChild(footer);
      }

      return root.innerHTML || base;
    } catch {
      return base;
    }
  }, [cleanHtml]);

  return (
    <div className="flex flex-1 justify-center overflow-y-auto bg-transparent p-5 lg:p-9">
      <div
        className={`relative w-full rounded-[30px] border border-slate-200/80 bg-white text-[#1a1c1c] shadow-[0_38px_100px_rgba(15,23,42,0.12)] transition-all duration-500 ${
          compact
            ? "min-h-[820px] max-w-[1020px] p-12 lg:p-16"
            : "min-h-[1120px] max-w-[980px] p-16 lg:p-20"
        }`}
      >
        {isGenerating ? <WritingSkeleton /> : null}
        <article
          ref={articleRef}
          data-aa-canvas-format={format}
          className={`aa-canvas prose prose-slate max-w-none prose-headings:font-extrabold prose-headings:tracking-tight prose-headings:text-emerald-900 prose-h1:mb-6 prose-h1:text-4xl prose-h1:leading-tight prose-h2:mb-5 prose-h2:mt-12 prose-h2:text-2xl prose-h3:mb-4 prose-h3:mt-8 prose-h3:text-xl prose-p:my-4 prose-p:leading-8 prose-p:text-[16px] prose-ul:my-5 prose-ul:list-disc prose-ul:pl-6 prose-ol:my-5 prose-ol:list-decimal prose-ol:pl-6 prose-li:my-3 prose-strong:text-slate-900 prose-table:my-8 prose-table:w-full prose-th:border prose-th:border-slate-300 prose-th:bg-slate-100 prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-slate-200 prose-td:px-2 prose-td:py-1 transition-opacity duration-300 ${
            isGenerating ? "opacity-0" : "opacity-100"
          } ${revealing ? "aa-canvas-revealing" : ""}`}
          dangerouslySetInnerHTML={{ __html: enhancedHtml }}
        />
        <style jsx global>{`
          .aa-canvas {
            font-family: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
            letter-spacing: 0.003em;
          }
          .aa-canvas [data-aa-role="worksheet-body"] {
            margin-top: 0.5rem;
          }
          .aa-canvas [data-aa-role="document-header"] {
            margin-bottom: 1.2rem;
            padding: 0.35rem 0 0.8rem;
            border-bottom: 1px solid #d1fae5;
          }
          .aa-canvas [data-aa-role="document-header"] h1 {
            margin-bottom: 0.45rem;
          }
          .aa-canvas [data-aa-role="instructions"] {
            border: 1px solid #bbf7d0;
            background: linear-gradient(180deg, #f0fdf4 0%, #ecfeff 100%);
            border-radius: 18px;
            padding: 16px 18px;
            margin: 14px 0 30px;
            font-weight: 600;
            color: #0f766e;
            line-height: 1.8;
          }
          .aa-canvas [data-aa-role="document-subtitle"],
          .aa-canvas [data-aa-role~="objective"] {
            margin-top: -0.4rem;
            margin-bottom: 1.2rem;
            border-left: 4px solid #34d399;
            padding: 0.5rem 0.9rem;
            border-radius: 12px;
            background: #f0fdf4;
            color: #0f766e;
            font-weight: 600;
          }
          .aa-canvas [data-aa-role="instruction-box"] {
            border: 1px solid #bbf7d0;
            background: linear-gradient(180deg, #f0fdf4 0%, #ecfeff 100%);
            border-radius: 18px;
            padding: 16px 18px;
            margin: 14px 0 30px;
            font-weight: 600;
            color: #0f766e;
            line-height: 1.8;
          }
          .aa-canvas [data-aa-role="question"] {
            font-weight: 700;
            margin-top: 12px;
          }
          .aa-canvas [data-aa-role="worksheet-section-title"] {
            margin-top: 1.5rem;
            margin-bottom: 1rem;
            padding: 0.8rem 1rem;
            border-radius: 16px;
            background: #f0fdf4;
            border: 1px solid #a7f3d0;
            color: #065f46;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            font-size: 0.8rem;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
          }
          .aa-canvas [data-aa-role="activities"] {
            margin-top: 1.45rem;
            display: grid;
            gap: 1.2rem;
          }
          .aa-canvas [data-aa-role="activities-panel"] {
            margin-top: 1rem;
            border: 1px solid #e2e8f0;
            border-radius: 22px;
            padding: 1rem;
            background: linear-gradient(180deg, #ffffff 0%, #fafcff 100%);
            display: grid;
            gap: 1rem;
          }
          .aa-canvas [data-aa-document-type="lectura_adaptada_preguntas"] [data-aa-role="reading-block"] {
            border: 1px solid #bae6fd;
            border-radius: 18px;
            background: linear-gradient(180deg, #f0f9ff 0%, #ffffff 100%);
            padding: 1rem 1.05rem;
            margin: 0.6rem 0 1rem;
          }
          .aa-canvas [data-aa-document-type="lectura_adaptada_preguntas"] [data-aa-role~="questions-block"] {
            border-color: #c7d2fe;
            background: linear-gradient(180deg, #ffffff 0%, #f8faff 100%);
          }
          .aa-canvas [data-aa-document-type="examen_adaptado"] [data-aa-role~="exam-panel"] {
            border: 1.5px solid #cbd5e1;
            background: #ffffff;
          }
          .aa-canvas [data-aa-document-type="examen_adaptado"] [data-aa-role~="exam-question"] {
            border-color: #cbd5e1;
            background: #f8fafc;
          }
          .aa-canvas [data-aa-document-type="pasos_secuenciados"] [data-aa-role="step-list"] {
            gap: 0.65rem;
            display: grid;
            margin-top: 0.6rem;
          }
          .aa-canvas [data-aa-document-type="pasos_secuenciados"] [data-aa-role="step-item"] {
            position: relative;
            padding-left: 2.75rem;
          }
          .aa-canvas [data-aa-document-type="pasos_secuenciados"] [data-aa-role="step-item"]::after {
            content: "☐";
            position: absolute;
            left: 0.95rem;
            top: 0.8rem;
            font-size: 0.95rem;
            color: #0f766e;
          }
          .aa-canvas [data-aa-document-type="resumen_adaptado"] [data-aa-role~="summary-panel"] {
            border: none;
            background: transparent;
            padding: 0;
            gap: 0.7rem;
          }
          .aa-canvas [data-aa-document-type="resumen_adaptado"] [data-aa-role~="summary-block"] {
            border-radius: 14px;
            border: 1px solid #e2e8f0;
            background: #f8fafc;
            box-shadow: none;
          }
          .aa-canvas [data-aa-document-type="esquema_visual_simple"] [data-aa-role~="schema-panel"] {
            border: none;
            background: transparent;
            padding: 0;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 0.8rem;
          }
          .aa-canvas [data-aa-document-type="esquema_visual_simple"] [data-aa-role~="schema-node"] {
            border: 1px solid #c7d2fe;
            border-radius: 14px;
            background: linear-gradient(180deg, #ffffff 0%, #f8faff 100%);
            padding: 0.8rem 0.9rem;
            min-height: 96px;
          }
          .aa-canvas [data-aa-role="activity-card"] {
            border: 1px solid #dbe7f8;
            border-radius: 20px;
            background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
            padding: 16px 18px 14px;
            box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
          }
          .aa-canvas [data-aa-role="structured-question-block"] {
            border: 1px solid #dbe7f8;
            border-radius: 18px;
            background: #ffffff;
            padding: 0.9rem 1rem 1rem;
            box-shadow: 0 8px 22px rgba(15, 23, 42, 0.05);
            display: grid;
            gap: 0.72rem;
          }
          .aa-canvas [data-aa-role="pictogram-sentence-row"] {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
            gap: 0.55rem;
            align-items: stretch;
            padding: 0.65rem;
            border: 1px solid #dbe7f8;
            border-radius: 14px;
            background: #f8fbff;
          }
          .aa-canvas [data-aa-role="response-boxes-row"] {
            border-top: 1px dashed #cbd5e1;
            padding-top: 0.65rem;
          }
          .aa-canvas [data-aa-role="worksheet-question"] {
            margin-top: 0.2rem;
            margin-bottom: 0.8rem;
            padding: 1rem 1.05rem;
            border-radius: 16px;
            border: 1px solid #dbe7f8;
            background: #f8fbff;
            font-weight: 700;
            line-height: 1.6;
          }
          .aa-canvas [data-aa-role="example-box"] {
            margin: 0.95rem 0 1rem;
            border-radius: 16px;
            border: 1px solid #cfe3ff;
            background: linear-gradient(180deg, #f8fbff 0%, #eff6ff 100%);
            padding: 0.85rem 1rem;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
          }
          .aa-canvas [data-aa-role="example-box"] p {
            margin: 0.2rem 0;
            color: #1e3a8a;
            font-weight: 600;
          }
          .aa-canvas [data-aa-role="keyword-chip-list"] {
            margin: 0.75rem 0 1.1rem;
            border: 1px dashed #bfdad0;
            border-radius: 14px;
            padding: 0.7rem 0.8rem;
            background: #f9fffd;
          }
          .aa-canvas [data-aa-role="keyword-chip-row"] {
            display: flex;
            flex-wrap: wrap;
            gap: 0.45rem;
            margin-top: 0.35rem;
          }
          .aa-canvas [data-aa-role="keyword-chip"] {
            display: inline-flex;
            align-items: center;
            border: 1px solid #a7f3d0;
            border-radius: 9999px;
            background: #ecfdf5;
            color: #065f46;
            font-size: 0.72rem;
            font-weight: 700;
            line-height: 1;
            padding: 0.38rem 0.62rem;
          }
          .aa-canvas [data-aa-role="response-lines"] {
            height: 132px;
            border-radius: 15px;
            margin: 14px 0 22px;
            border: 1px solid #cfd8e7;
            background: repeating-linear-gradient(
              to bottom,
              #ffffff 0px,
              #ffffff 32px,
              #cbd5e1 32px,
              #cbd5e1 33px
            );
          }
          .aa-canvas [data-aa-role="response-box"] {
            min-height: 170px;
            border: 1.5px dashed #94a3b8;
            border-radius: 15px;
            margin: 14px 0 24px;
            background: #fff;
          }
          .aa-canvas [data-aa-role="simple-table"] {
            border-collapse: collapse;
            margin-top: 1rem;
            margin-bottom: 1.2rem;
          }
          .aa-canvas [data-aa-role="section-divider"] {
            position: relative;
          }
          .aa-canvas [data-aa-role="section-divider"]::after {
            content: "";
            display: block;
            margin-top: 0.55rem;
            width: 100%;
            height: 1px;
            background: linear-gradient(90deg, #86efac 0%, rgba(134, 239, 172, 0) 100%);
          }
          .aa-canvas ol > li,
          .aa-canvas ul > li {
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            padding: 14px 16px;
            margin: 12px 0 16px;
            background: #fcfcfd;
            list-style-position: inside;
          }
          .aa-canvas [data-aa-role="exercise-list"] {
            margin: 0.35rem 0 0.75rem;
            padding-left: 0;
            list-style: none;
          }
          .aa-canvas [data-aa-role="exercise-list"] > li {
            list-style: none;
            margin: 0.5rem 0;
            border: 1px solid #dbe7f8;
            background: #ffffff;
            box-shadow: 0 6px 18px rgba(15, 23, 42, 0.04);
          }
          .aa-canvas [data-aa-role="pictogram-strip"] {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            align-items: center;
            margin-bottom: 12px;
            padding: 10px 12px;
            border-radius: 16px;
            border: 1px solid #e2e8f0;
            background: #f8fafc;
          }
          .aa-canvas [data-aa-role="pictogram-grid"] {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 16px;
            margin: 10px 0 22px;
          }
          .aa-canvas [data-aa-role="pictogram-card"] {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            gap: 9px;
            padding: 12px 10px;
            border-radius: 16px;
            border: 1px solid #dbe7f8;
            background: #ffffff;
            min-height: 132px;
          }
          .aa-canvas [data-aa-role="pictogram-word"] {
            font-size: 0.7rem;
            line-height: 1.2;
            font-weight: 700;
            color: #475569;
            text-align: center;
            text-transform: lowercase;
          }
          .aa-canvas [data-aa-role="pictogram-text-block"] {
            line-height: 1.75;
            margin-top: 0.25rem;
          }
          .aa-canvas img[data-aa-pictogram] {
            display: inline-block;
            vertical-align: middle;
            width: 88px;
            height: 88px;
            object-fit: contain;
            margin-right: 0;
            margin-bottom: 0;
            border-radius: 12px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            padding: 6px;
          }
          .aa-canvas [data-aa-pictogram-board="1"][data-aa-level="alto"] img[data-aa-pictogram] {
            width: 108px;
            height: 108px;
          }
          .aa-canvas [data-aa-pictogram-board="1"][data-aa-level="alto"] [data-aa-role="pictogram-card"] {
            min-height: 168px;
            padding: 14px 10px;
          }
          .aa-canvas [data-aa-material="ficha_trabajo"] [data-aa-role="response-lines"],
          .aa-canvas [data-aa-material="metacognicion"] [data-aa-role="response-lines"],
          .aa-canvas [data-aa-material="repaso"] [data-aa-role="response-lines"],
          .aa-canvas [data-aa-material="examen"] [data-aa-role="response-lines"] {
            height: 84px;
            border: 1px solid #d6dde8;
            background: repeating-linear-gradient(
              to bottom,
              #ffffff 0px,
              #ffffff 24px,
              #c7d1e0 24px,
              #c7d1e0 25px
            );
          }
          .aa-canvas [data-aa-material="ficha_trabajo"] [data-aa-role="response-box"],
          .aa-canvas [data-aa-material="metacognicion"] [data-aa-role="response-box"],
          .aa-canvas [data-aa-material="repaso"] [data-aa-role="response-box"],
          .aa-canvas [data-aa-material="examen"] [data-aa-role="response-box"] {
            min-height: 120px;
            border-width: 2px;
          }
          .aa-canvas [data-aa-role="step-list"] {
            list-style: none;
            padding-left: 0;
            counter-reset: aa-steps;
          }
          .aa-canvas [data-aa-role="step-item"] {
            list-style: none;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 10px 14px;
            margin: 10px 0;
            background: #f8fafc;
          }
          .aa-canvas [data-aa-role="step-item"]::before {
            counter-increment: aa-steps;
            content: counter(aa-steps);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
            border-radius: 9999px;
            margin-right: 8px;
            background: #d1fae5;
            color: #065f46;
            font-size: 12px;
            font-weight: 800;
          }
          .aa-canvas [data-aa-role="concept-card"] {
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 10px 12px;
            background: #f8fafc;
          }
          .aa-canvas[data-aa-canvas-format="lectura"] p {
            line-height: 1.85;
            font-size: 1.04rem;
          }
          .aa-canvas[data-aa-canvas-format="resumen"] h2 {
            margin-top: 1.3rem;
          }
          .aa-canvas[data-aa-canvas-format="examen"] [data-aa-role="instructions"] {
            background: #f8fafc;
            border-color: #cbd5e1;
          }
          .aa-canvas [data-aa-role="worksheet-footer"] {
            margin-top: 1.7rem;
            padding-top: 0.8rem;
            border-top: 1px dashed #cbd5e1;
            color: #64748b;
            font-size: 0.88rem;
          }
          @keyframes aa-block-reveal {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .aa-canvas-revealing > * {
            opacity: 0;
            animation: aa-block-reveal 0.45s ease forwards;
          }
          .aa-canvas-revealing > *:nth-child(1)  { animation-delay: 0.05s; }
          .aa-canvas-revealing > *:nth-child(2)  { animation-delay: 0.18s; }
          .aa-canvas-revealing > *:nth-child(3)  { animation-delay: 0.31s; }
          .aa-canvas-revealing > *:nth-child(4)  { animation-delay: 0.44s; }
          .aa-canvas-revealing > *:nth-child(5)  { animation-delay: 0.57s; }
          .aa-canvas-revealing > *:nth-child(6)  { animation-delay: 0.70s; }
          .aa-canvas-revealing > *:nth-child(7)  { animation-delay: 0.83s; }
          .aa-canvas-revealing > *:nth-child(8)  { animation-delay: 0.96s; }
          .aa-canvas-revealing > *:nth-child(9)  { animation-delay: 1.09s; }
          .aa-canvas-revealing > *:nth-child(10) { animation-delay: 1.22s; }
          .aa-canvas-revealing > *:nth-child(11) { animation-delay: 1.35s; }
          .aa-canvas-revealing > *:nth-child(12) { animation-delay: 1.48s; }
          .aa-canvas-revealing > *:nth-child(n+13) { animation-delay: 1.55s; }
          .aa-canvas [data-aa-role="review-checklist"] {
            margin-top: 1.25rem;
            border: 1px solid #dbeafe;
            border-radius: 16px;
            background: #f8fbff;
            padding: 0.9rem 1rem 1rem;
          }
          .aa-canvas [data-aa-role="review-checklist"] h3 {
            margin-top: 0;
            margin-bottom: 0.45rem;
            font-size: 0.95rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #1e40af;
          }
          .aa-canvas [data-aa-role="review-checklist"] ul {
            margin: 0;
            padding-left: 1.2rem;
          }
          .aa-canvas [data-aa-role="review-checklist"] li {
            margin: 0.25rem 0;
            border: none;
            background: transparent;
            padding: 0;
          }
        `}</style>
      </div>
    </div>
  );
}
