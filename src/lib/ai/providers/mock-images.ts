import type { ImageProvider, ImageRequest, ImageResponse } from "../types";

/**
 * Development and E2E without spending: a plain, deterministic schematic drawing (an outline with a few inner shapes) of the
 * requested size. It is never reachable in production (the router refuses it) and its review is the pipeline's job, as with a
 * real model. The prompt is not interpreted.
 */
export class MockImageProvider implements ImageProvider {
  readonly name = "mock" as const;

  async generateImage(request: ImageRequest): Promise<ImageResponse> {
    const started = Date.now();
    const [width, height] = request.size.split("x").map(Number) as [number, number];
    const napi = await import("@napi-rs/canvas");
    const canvas = napi.createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#1f1f1f";
    ctx.lineWidth = Math.max(4, Math.round(width / 200));
    ctx.beginPath();
    ctx.ellipse(width / 2, height / 2, width * 0.38, height * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#d9d9d9";
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, Math.min(width, height) * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    for (const [dx, dy] of [[-0.2, -0.12], [0.18, 0.1], [-0.12, 0.15]] as const) {
      ctx.beginPath();
      ctx.ellipse(width / 2 + dx * width, height / 2 + dy * height, width * 0.045, height * 0.025, 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    const data = new Uint8Array(await canvas.encode("png"));
    return { image: { data, mediaType: "image/png" }, usage: { textInputTokens: 0, imageInputTokens: 0, outputTokens: 0 }, provider: "mock", model: request.selection.model, latencyMs: Date.now() - started };
  }
}
