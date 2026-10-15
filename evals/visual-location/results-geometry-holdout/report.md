# Geometría de figuras — geometry_holdout

Fichas sintéticas. Las cajas de referencia solo puntúan. Ninguna figura se aprueba: decisión siempre BLOCKED.

```json
{
  "locator": "figure_geometry@v2",
  "corpus": "geometry_holdout",
  "pages": 10,
  "visuals": 11,
  "eligible": 6,
  "negatives": 5,
  "baseline": {
    "candidates": 0,
    "correct": 0,
    "wrong": 0
  },
  "v2": {
    "candidates": 3,
    "correct": 2,
    "wrong": 1,
    "incompleteCandidates": 0,
    "incomplete": 0,
    "semanticBlock": 1,
    "unverifiable": 1,
    "notFound": 2,
    "negativesRejected": 4,
    "distractorsAccepted": 0,
    "accepted": 0
  },
  "geometryMsPerPage": {
    "median": 71,
    "max": 411
  },
  "peakRssMb": 984
}
```

| página | visual | tipo | elegible | antes (#31) | después (v2) | IoU | etiquetas dentro | trazos cortados | zona | forma | bloqueo | categoría |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h_barra_gris | vis_1 | bar | sí | snap | no_encontrada | 0.19 | 0/0 | 4 | 0–210 mm | — | integrity:failed | geometria |
| h_recta_flechas | vis_1 | number_line | sí | snap | sin_verificar | 0.18 | 3/5 | 0 | 0–210 mm | number_line | uniqueness:failed | geometria |
| h_reloj_completo | vis_1 | figure | sí | uniqueness | correcta | 0.86 | 12/12 | 0 | 0–210 mm | dial | candidata | — |
| h_columnas_parecidas | vis_1 | figure | sí | uniqueness | bloqueo_semantico | 0.81 | 0/0 | 0 | 0–96 mm (columna) | — | identity_evidence:unverifiable | semantica |
| h_columnas_parecidas | vis_2 | figure | sí | activity_anchor | no_encontrada | — | 0/0 | 0 | 96–210 mm (columna) | — | snap:failed | geometria |
| h_esquema_diagonal | vis_1 | figure | sí | uniqueness | correcta | 0.72 | 3/3 | 0 | 0–210 mm | instruction_labels | candidata | — |
| hn_respuesta_dibujada | vis_1 | bar | no | uniqueness | candidata_erronea | 0.67 | 0/0 | 0 | 0–210 mm | bar | candidata | — |
| hn_superpuestas | vis_1 | figure | no | uniqueness | rechazada | 0.75 | 0/0 | 0 | 0–210 mm | — | identity_evidence:unverifiable | semantica |
| hn_recuadros | vis_1 | figure | no | — | rechazada | — | 0/0 | 0 | 0–210 mm | — | identity_evidence:unverifiable | semantica |
| hn_entre_actividades | vis_1 | figure | no | snap | rechazada | — | 0/0 | 0 | 0–210 mm | — | snap:failed | geometria |
| hn_tabla_barra | vis_1 | bar | no | — | rechazada | — | 0/0 | 0 | 0–210 mm | — | identity_evidence:failed | geometria |
