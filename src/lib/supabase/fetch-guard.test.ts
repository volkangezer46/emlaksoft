import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEDGE_MS, createGuardedFetch, isRetrySafe } from "./fetch-guard";

const URL_REST = "https://x.supabase.co/rest/v1/deals?select=id";

function hang(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

describe("fetch-guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("yalnız okuma istekleri güvenle yinelenir", () => {
    expect(isRetrySafe("GET", "/rest/v1/deals")).toBe(true);
    expect(isRetrySafe("HEAD", "/rest/v1/deals")).toBe(true);
    expect(isRetrySafe("POST", "/rest/v1/rpc/app_shell_bootstrap")).toBe(true);
    expect(isRetrySafe("POST", "/rest/v1/rpc/baska_rpc")).toBe(false);
    expect(isRetrySafe("POST", "/rest/v1/deals")).toBe(false);
    expect(isRetrySafe("PATCH", "/rest/v1/deals")).toBe(false);
    expect(isRetrySafe("DELETE", "/rest/v1/deals")).toBe(false);
  });

  it("takılan GET, bekleme süresinden sonra yeni istekle kurtarılır", async () => {
    let calls = 0;
    const base = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      return calls === 1 ? hang(init?.signal) : Promise.resolve(new Response("ok", { status: 200 }));
    });
    const f = createGuardedFetch(base as unknown as typeof fetch);
    const p = f(URL_REST);
    await vi.advanceTimersByTimeAsync(HEDGE_MS + 10);
    const res = await p;
    expect(await res.text()).toBe("ok");
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("hızlı GET tek istek atar", async () => {
    const base = vi.fn(() => Promise.resolve(new Response("ok")));
    const f = createGuardedFetch(base as unknown as typeof fetch);
    await f(URL_REST);
    await vi.advanceTimersByTimeAsync(HEDGE_MS * 2);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("ağ hatasında GET bir kez hemen yinelenir", async () => {
    let calls = 0;
    const base = vi.fn(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new TypeError("fetch failed")) : Promise.resolve(new Response("ok"));
    });
    const f = createGuardedFetch(base as unknown as typeof fetch);
    const res = await f(URL_REST);
    expect(await res.text()).toBe("ok");
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("mutasyon asla yinelenmez", async () => {
    const base = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    const f = createGuardedFetch(base as unknown as typeof fetch);
    await expect(f("https://x.supabase.co/rest/v1/deals", { method: "POST", body: "{}" })).rejects.toThrow("fetch failed");
    expect(base).toHaveBeenCalledTimes(1);
  });
});
