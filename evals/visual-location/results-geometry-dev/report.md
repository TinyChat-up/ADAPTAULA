# Geometría de figuras — geometry_dev

Fichas sintéticas. Las cajas de referencia solo puntúan. Ninguna figura se aprueba: decisión siempre BLOCKED.

```json
{
  "locator": "figure_geometry@v2",
  "corpus": "geometry_dev",
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
    "candidates": 5,
    "correct": 5,
    "wrong": 0,
    "incompleteCandidates": 0,
    "incomplete": 0,
    "semanticBlock": 0,
    "unverifiable": 1,
    "notFound": 0,
    "negativesRejected": 5,
    "distractorsAccepted": 0,
    "accepted": 0
  },
  "geometryMsPerPage": {
    "median": 64,
    "max": 208
  },
  "peakRssMb": 909
}
```

| página | visual | tipo | elegible | antes (#31) | después (v2) | IoU | etiquetas dentro | trazos cortados | zona | forma | bloqueo | categoría |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| d_barra_seis | vis_1 | bar | sí | uniqueness | correcta | 0.75 | 0/0 | 0 | 0–210 mm | bar | candidata | — |
| d_recta_letra | vis_1 | number_line | sí | snap | sin_verificar | 0.62 | 7/7 | 0 | 0–210 mm | number_line | labels:unverifiable | ocr |
| d_reloj | vis_1 | figure | sí | uniqueness | correcta | 0.83 | 4/4 | 0 | 0–210 mm | dial | candidata | — |
| d_columnas | vis_1 | figure | sí | uniqueness | correcta | 0.81 | 0/0 | 0 | 0–97 mm (columna) | triangle | candidata | — |
| d_columnas | vis_2 | figure | sí | activity_anchor | correcta | 0.8 | 0/0 | 0 | 97–210 mm (columna) | rectangle | candidata | — |
| d_esquema | vis_1 | figure | sí | uniqueness | correcta | 0.78 | 3/3 | 0 | 0–210 mm | instruction_labels | candidata | — |
| dn_sin_figura | vis_1 | figure | no | — | rechazada | — | 0/0 | 0 | 0–210 mm | — | snap:failed | geometria |
| dn_tabla_barra | vis_1 | bar | no | — | rechazada | — | 0/0 | 0 | 0–210 mm | — | identity_evidence:failed | geometria |
| dn_dos_figuras | vis_1 | figure | no | uniqueness | rechazada | 0.81 | 0/0 | 0 | 0–210 mm | triangle | uniqueness:failed | geometria |
| dn_cortada | vis_1 | bar | no | uniqueness | rechazada | 0.77 | 0/0 | 0 | 0–210 mm | bar | integrity:failed | geometria |
| dn_cruza_columnas | vis_1 | figure | no | uniqueness | rechazada | — | 0/0 | 0 | 0–97 mm (columna) | — | snap:failed | geometria |
