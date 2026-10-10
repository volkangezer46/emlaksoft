import { describe, expect, it } from "vitest";
import { heartbeatFor } from "@/lib/cron-heartbeat-status";
import { readAllPaged } from "./read-all-paged";

const page = (total: number) => async (from: number, to: number) => ({
  data: Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => from + i),
  error: null,
});

describe("readAllPaged", () => {
  it("1000'den fazla satırı sayfalayarak okur", async () => {
    const r = await readAllPaged(page(2500));
    expect(r.rows).toHaveLength(2500);
    expect(r.truncated).toBe(false);
    expect(r.error).toBeNull();
  });

  it("üst sınıra dayanınca truncated döner", async () => {
    const r = await readAllPaged(page(10_000), { maxRows: 3000 });
    expect(r.rows).toHaveLength(3000);
    expect(r.truncated).toBe(true);
  });

  it("hatada kısmi satır ve hata mesajı döner", async () => {
    const r = await readAllPaged(async (from) =>
      from === 0 ? { data: Array(1000).fill(1), error: null } : { data: null, error: { message: "boom" } },
    );
    expect(r.error).toBe("boom");
    expect(r.rows).toHaveLength(1000);
  });
});

describe("heartbeatFor", () => {
  it("hata sayacı ya da kesilme varsa error", () => {
    expect(heartbeatFor({ failed: 0 })).toBe("ok");
    expect(heartbeatFor({ failed: 2 })).toBe("error");
    expect(heartbeatFor({ failed: 0, truncated: true })).toBe("error");
  });
});
