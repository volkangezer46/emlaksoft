const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

export type ExternalFetchOptions = {
  timeoutMs: number;
  signal?: AbortSignal | null;
};

export class ExternalHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("External service returned a non-success response.");
    this.name = "ExternalHttpError";
    this.status = status;
  }
}

export class ExternalResponseTooLargeError extends Error {
  constructor() {
    super("External service response exceeded the configured limit.");
    this.name = "ExternalResponseTooLargeError";
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

/**
 * Combines a request/caller cancellation signal with a hard deadline.
 * `AbortSignal.any` preserves the reason of the first signal that aborts.
 */
export function composeExternalAbortSignal(
  timeoutMs: number,
  ...callerSignals: Array<AbortSignal | null | undefined>
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(positiveInteger(timeoutMs, "timeoutMs"));
  const signals = callerSignals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (signals.length === 0) return timeoutSignal;
  return AbortSignal.any([...signals, timeoutSignal]);
}

/**
 * Server-side provider fetch boundary. Redirects are always rejected so
 * bearer tokens, signed payloads and provider credentials cannot be forwarded
 * to a different origin. Every request also has a bounded lifetime.
 */
export async function fetchExternal(
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  options: ExternalFetchOptions,
): Promise<Response> {
  const signal = composeExternalAbortSignal(options.timeoutMs, init.signal, options.signal);
  return fetch(input, {
    ...init,
    redirect: "error",
    signal,
  });
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best effort: the connection may already be closed or locked.
  }
}

/** Discards an untrusted provider body without parsing or logging it. */
export async function discardExternalResponse(response: Response): Promise<void> {
  await cancelBody(response);
}

/** Throws a body-free, log-safe error for non-2xx provider responses. */
export async function requireExternalSuccess(response: Response): Promise<void> {
  if (response.ok) return;
  await cancelBody(response);
  throw new ExternalHttpError(response.status);
}

/** Reads a response with a byte cap, including chunked bodies. */
export async function readExternalText(
  response: Response,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
): Promise<string> {
  const limit = positiveInteger(maxBytes, "maxBytes");
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > limit) {
    await cancelBody(response);
    throw new ExternalResponseTooLargeError();
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > limit) {
        await reader.cancel();
        throw new ExternalResponseTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

/** Parses JSON only after enforcing the response byte cap. */
export async function readExternalJson<T>(
  response: Response,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
): Promise<T> {
  return JSON.parse(await readExternalText(response, maxBytes)) as T;
}

/** Safe observability metadata: never includes provider bodies or messages. */
export function externalErrorMetadata(error: unknown): {
  kind: "aborted" | "timeout" | "http" | "response_too_large" | "invalid_response" | "request_failed";
  status?: number;
} {
  if (error instanceof ExternalHttpError) return { kind: "http", status: error.status };
  if (error instanceof ExternalResponseTooLargeError) return { kind: "response_too_large" };
  if (error instanceof SyntaxError) return { kind: "invalid_response" };
  if (error instanceof Error && error.name === "TimeoutError") return { kind: "timeout" };
  if (error instanceof Error && error.name === "AbortError") return { kind: "aborted" };
  return { kind: "request_failed" };
}
