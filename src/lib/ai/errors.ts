export type AIErrorCode =
  | "not_configured"
  | "provider_unavailable"
  | "rate_limited"
  | "timeout"
  | "auth"
  | "bad_request"
  | "refusal"
  | "truncated"
  | "invalid_output"
  | "unknown";

const RETRYABLE: ReadonlySet<AIErrorCode> = new Set(["provider_unavailable", "rate_limited", "timeout"]);

/** Categorized failure. `message` is for logs only and never reaches the user. */
export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly retryable: boolean;

  constructor(code: AIErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AIError";
    this.code = code;
    this.retryable = RETRYABLE.has(code);
  }
}

export function toAIError(error: unknown): AIError {
  return error instanceof AIError ? error : new AIError("unknown", error instanceof Error ? error.message : "unknown error", { cause: error });
}

/**
 * What the job does with a failure (see ANALYSIS_RETRY in config.ts for the whole policy).
 * Only transient provider errors (network, timeout, 5xx/overloaded, rate limit) and genuinely unexpected errors are
 * retried, and always within the job's attempt budget. Refusals, invalid or truncated output that already used its
 * single repair/regeneration, bad requests, credentials and corrupt input are final.
 */
export function jobFailureDecision(error: unknown): { code: FailureCode; retryable: boolean } {
  const failure = toAIError(error);
  if (failure.code === "unknown") return { code: "unexpected", retryable: true };
  return { code: failure.code, retryable: failure.retryable };
}

/** Failure codes a material can carry (AI errors plus pipeline ones). */
export type FailureCode = AIErrorCode | "file_missing" | "file_unreadable" | "attempts_exhausted" | "unexpected";

/**
 * The reason shown under the heading «No hemos podido analizar este material.» (so it never repeats it). Generic on purpose: no vendor, model, token or technical detail,
 * and no blame on the file unless it really is the file.
 */
export function failureMessage(code: string | null): string {
  switch (code) {
    case "not_configured":
    case "provider_unavailable":
    case "rate_limited":
    case "timeout":
    case "auth":
      return "El servicio de análisis no está disponible ahora mismo. No es culpa de tu archivo: inténtalo de nuevo en unos minutos.";
    case "file_missing":
    case "file_unreadable":
      return "No hemos podido leer el archivo guardado. Prueba a subirlo de nuevo.";
    case "refusal":
      return "Comprueba que sea una ficha educativa y vuelve a intentarlo.";
    case "truncated":
      return "Es demasiado extenso para analizarlo de una vez. Prueba con menos páginas.";
    default:
      return "Puedes reintentarlo; si vuelve a fallar, prueba con otro archivo.";
  }
}
