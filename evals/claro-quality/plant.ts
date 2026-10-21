import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { assetRef, type PinnedAsset } from "@/lib/render/print/pinned-assets";

/** Original hand-authored test artwork. Markers are drawn, but the exported PNG has no machine-verifiable semantic evidence. */
export async function plantAsset() {
  const canvas = createCanvas(900, 600);
  const c = canvas.getContext("2d");
  c.fillStyle = "white"; c.fillRect(0, 0, 900, 600);
  c.strokeStyle = "#202020"; c.fillStyle = "#202020"; c.lineWidth = 5;
  const line = (points: number[][]) => { c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x!, y!) : c.moveTo(x!, y!)); c.stroke(); };
  line([[410, 410], [410, 120]]);
  for (const [x, y, tilt] of [[345, 190, .5], [475, 275, -.5]]) {
    c.beginPath(); c.ellipse(x!, y!, 75, 32, tilt!, 0, 2 * Math.PI); c.stroke();
  }
  line([[410, 410], [350, 500], [310, 530]]);
  line([[410, 410], [460, 490], [510, 520]]);
  line([[410, 410], [405, 535]]);
  c.lineWidth = 3;
  line([[620, 170], [515, 170], [375, 190]]);
  line([[620, 350], [515, 350], [410, 350]]);
  line([[620, 510], [555, 510], [460, 490]]);
  c.font = "bold 34px sans-serif";
  c.fillText("1", 640, 180); c.fillText("2", 640, 360); c.fillText("3", 640, 520);
  const bytes = new Uint8Array(await canvas.encode("png"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const assetId = "11111111-3333-4333-8333-111111111111";
  const pin: PinnedAsset = { assetId, sha256, mime: "image/png", bytes };
  return { pin, source: { src: assetRef({ assetId, sha256 }), widthMm: 115 } };
}
