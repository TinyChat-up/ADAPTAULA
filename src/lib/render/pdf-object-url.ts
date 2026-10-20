/** A download can consume its URL after the click. Release with a bounded grace period only in that case. */
export function pdfObjectUrl(blob: Blob, urls: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL) {
  const url = urls.createObjectURL(blob);
  let downloaded = false, released = false;
  return {
    url,
    markDownloaded() { downloaded = true; },
    release() {
      if (released) return;
      released = true;
      if (downloaded) setTimeout(() => urls.revokeObjectURL(url), 60_000);
      else urls.revokeObjectURL(url);
    },
  };
}
