import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeExternalAbortSignal,
  externalErrorMetadata,
  fetchExternal,
  readExternalText,
  requireExternalSuccess,
} from "./external-fetch";

describe("external provider fetch boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forces redirect rejection and composes caller cancellation with a deadline", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const caller = new AbortController();

    await fetchExternal(
      "https://provider.example/api",
      { redirect: "follow", signal: caller.signal },
      { timeoutMs: 30_000 },
    );

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);

    caller.abort("caller_cancelled");
    expect(init.signal?.aborted).toBe(true);
    expect(init.signal?.reason).toBe("caller_cancelled");
  });

  it("creates a bounded timeout signal", async () => {
    const signal = composeExternalAbortSignal(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).name).toBe("TimeoutError");
  });

  it("rejects declared and chunked bodies above the byte limit", async () => {
    await expect(
      readExternalText(new Response("secret", { headers: { "content-length": "6" } }), 5),
    ).rejects.toMatchObject({ name: "ExternalResponseTooLargeError" });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("abc"));
        controller.enqueue(new TextEncoder().encode("def"));
        controller.close();
      },
    });
    await expect(readExternalText(new Response(stream), 5)).rejects.toMatchObject({
      name: "ExternalResponseTooLargeError",
    });
  });

  it("never includes an untrusted error body in the thrown error or log metadata", async () => {
    const response = new Response("provider-secret-or-pii", { status: 401 });
    let caught: unknown;
    try {
      await requireExternalSuccess(response);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain("provider-secret-or-pii");
    expect(externalErrorMetadata(caught)).toEqual({ kind: "http", status: 401 });
  });
});
