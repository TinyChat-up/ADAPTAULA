import "server-only";
import { parseServerEnv, type ServerEnv } from "./env.server-schema";

let cached: ServerEnv | undefined;

/** Lazy so that `next build` and static pages never need runtime secrets. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
