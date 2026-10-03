import { describe, expect, it, vi } from "vitest";
import { hybridCount } from "./nav-badges";

describe("hybridCount (B11)", () => {
  it("tahmin limitin yarısının altındaysa kesin sayıma gitmez", async () => {
    const run = vi.fn(async (mode: "exact" | "estimated") => ({ count: mode === "estimated" ? 100 : 123, error: null }));
    expect((await hybridCount(1000, run)).count).toBe(100);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("estimated");
  });
  it("tahmin eşiğe yaklaştıysa kesin sayım yapar", async () => {
    const run = vi.fn(async (mode: "exact" | "estimated") => ({ count: mode === "estimated" ? 600 : 612, error: null }));
    expect((await hybridCount(1000, run)).count).toBe(612);
    expect(run).toHaveBeenLastCalledWith("exact");
  });
  it("tahmin hata verir veya null ise kesin sayıma düşer", async () => {
    const run = vi.fn(async (mode: "exact" | "estimated") =>
      mode === "estimated" ? { count: null, error: { message: "x" } } : { count: 7, error: null },
    );
    expect((await hybridCount(1000, run)).count).toBe(7);
  });
});
