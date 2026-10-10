import { afterEach, describe, expect, it, vi } from "vitest";

/** after() geri çağrısı sonradan (yanıttan sonra) çalıştırılır; test onu elle tetikler. */
const queue: Array<() => unknown> = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void queue.push(fn) }));

import { afterSafe } from "./after-safe";

const flush = async () => {
  for (const fn of queue.splice(0)) await fn();
};

describe("afterSafe: yanıtı bekletmez, hatayı yutmaz", () => {
  afterEach(() => vi.restoreAllMocks());

  it("görev çağrı anında çalışmaz (yanıt beklemez), flush'ta çalışır", async () => {
    const task = vi.fn();
    afterSafe(task);
    expect(task).not.toHaveBeenCalled();
    await flush();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("eşzamanlı fırlatma ve reddedilen Promise günlüğe yazılır, asla fırlatmaz", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    afterSafe(() => {
      throw new Error("senkron patladı");
    }, "audit");
    afterSafe(() => Promise.reject(new Error("async patladı")), "playbook");
    await expect(flush()).resolves.toBeUndefined();
    const logged = spy.mock.calls.map((c) => c.join(" "));
    expect(logged.some((l) => l.includes("audit") && l.includes("senkron patladı"))).toBe(true);
    expect(logged.some((l) => l.includes("playbook") && l.includes("async patladı"))).toBe(true);
  });
});
