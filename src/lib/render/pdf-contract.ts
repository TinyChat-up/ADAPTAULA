/** Metadata of the SAME bytes checked by validatePdf; never derived from logical CLARO pages. */
export const PDF_HEADERS = { pages: "X-PDF-Page-Count", bytes: "X-PDF-Byte-Length", revision: "X-PDF-Revision" } as const;
export const pdfRevision = (revision?: number) => revision === undefined ? "generated" : `draft:${revision}`;
