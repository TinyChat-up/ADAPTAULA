import type { MaterialDocument } from "@/lib/schemas/material-document";
import { b, sheet } from "./fixtures";

/**
 * Sistema CLARO · two editorial PILOTS (one A4 page each) for human review of the visual direction. They are excerpts of the
 * Phase 8 QA sheets, re-ordered where the human review found a pedagogical problem (reading next to its questions, the
 * organiser BEFORE the essay), and rendered by the real renderer with `design: "claro"`. They are not complete sheets.
 */

/** Pilot A · Primaria: from «El ciclo del agua» (QA sheet B). Orientation, reading by parts, a key idea, two guided tasks. */
export const pilotPrimary = (): MaterialDocument =>
  sheet({ title: "El ciclo del agua", stage: "primaria", grade: "4-primaria", subject: "Ciencias de la Naturaleza", topic: "El ciclo del agua" }, [
    [
      b.h("El ciclo del agua", 1),
      b.instruction("Vamos a trabajar paso a paso.", ["Lee el texto por partes.", "Después de cada parte, piensa qué ha pasado con el agua.", "Responde a las preguntas de una en una."]),
      b.reading(
        ["El sol calienta el agua de los mares y los ríos. El agua se convierte en vapor y sube al cielo.", "Arriba hace frío. El vapor se enfría y forma pequeñas gotas. Así nacen las nubes.", "Cuando las gotas pesan mucho, caen en forma de lluvia o de nieve. El agua vuelve a los ríos y al mar."],
        "Un viaje sin fin",
        ["Parte 1", "Parte 2", "Parte 3"],
      ),
      b.help("key_idea", "El agua **cambia de estado**, pero no desaparece: siempre vuelve a empezar el viaje."),
      b.activity("1", "¿Qué hace el sol con el agua del mar?", { kind: "lines", lines: 2 }, { steps: ["Busca la respuesta en la Parte 1.", "Escríbela con tus palabras."] }),
      b.activity("2", "Ordena lo que le pasa al agua. Escribe 1, 2 y 3 en los cuadros.", { kind: "order", items: [{ id: "o1", text: "Se forman las nubes." }, { id: "o2", text: "El agua se evapora." }, { id: "o3", text: "Llueve." }] }),
    ],
  ]);

/** Pilot B · Bachillerato: from «Comentario de texto: el contrato social» (QA sheet D). Reading, analysis, organiser, then the essay. */
export const pilotBachillerato = (): MaterialDocument =>
  sheet({ title: "Comentario de texto: el contrato social", stage: "bachillerato", grade: "2-bachillerato", subject: "Historia de la Filosofía", topic: "Rousseau" }, [
    [
      b.h("Comentario de texto: el contrato social", 1),
      b.instruction("Lee el fragmento con atención y realiza las actividades en el orden propuesto. Cita el texto cuando lo necesites."),
      b.reading(
        [
          "«Encontrar una forma de asociación que defienda y proteja con toda la fuerza común la persona y los bienes de cada asociado, y por la cual cada uno, uniéndose a todos, no obedezca sin embargo más que a sí mismo y permanezca tan libre como antes.» Tal es el problema fundamental cuya solución da el contrato social.",
          "Estas cláusulas, bien entendidas, se reducen todas a una sola, a saber: la enajenación total de cada asociado con todos sus derechos a toda la comunidad. Porque, en primer lugar, al darse cada uno por entero, la condición es igual para todos; y siendo la condición igual para todos, nadie tiene interés en hacerla onerosa para los demás.",
        ],
        "J.-J. Rousseau, Del contrato social (1762), libro I, cap. VI",
      ),
      b.h("Actividades", 2),
      b.activity("1", "Identifica la **tesis** del fragmento y formúlala con tus propias palabras.", { kind: "lines", lines: 2 }),
      b.planner([{ label: "Qué problema plantea Rousseau", lines: 1 }, { label: "Qué solución propone", lines: 1 }, { label: "Qué significa «enajenación total»", lines: 1 }], "Organiza tu respuesta antes de escribir"),
      b.activity("2", "Explica la solución que propone Rousseau y el sentido de la «enajenación total» en el fragmento.", { kind: "lines", lines: 5 }, { requirements: ["Entre 40 y 50 palabras, citando al menos una expresión del texto"] }),
    ],
  ]);

export const PILOTS = [
  { name: "piloto-primaria", doc: pilotPrimary },
  { name: "piloto-bachillerato", doc: pilotBachillerato },
] as const;
