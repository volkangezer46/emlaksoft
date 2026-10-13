import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LICENSE_SETUP_TASK_TITLE, pickLicenseSetupTargets, runLicenseSetupTasks } from "./license-setup";

describe("yetki belgesi no kurulum görevi (EP5)", () => {
  it("yalnız numarası boş, görevi açılmamış ve sahibi olan ofis seçilir", () => {
    const targets = pickLicenseSetupTargets(
      [
        { id: "t1", license_no: null },
        { id: "t2", license_no: " 3401234 " },
        { id: "t3", license_no: "  " },
        { id: "t4", license_no: null },
        { id: "t5", license_no: null },
      ],
      new Set(["t4"]),
      [
        { id: "o1", tenant_id: "t1" },
        { id: "o1b", tenant_id: "t1" },
        { id: "o3", tenant_id: "t3" },
        { id: "o4", tenant_id: "t4" },
      ],
    );
    expect(targets).toEqual([
      { tenantId: "t1", ownerId: "o1" },
      { tenantId: "t3", ownerId: "o3" },
    ]);
  });

  it("tek seferlik: ikinci turda aynı ofise yeniden görev açılmaz", async () => {
    const tasks: Array<{ tenant_id: string; title: string; assigned_to: string }> = [];
    const fake = {
      from(table: string) {
        const q: Record<string, unknown> = {};
        const chain = {
          select: () => chain,
          in: (_c: string, v: string[]) => ((q.in = v), chain),
          eq: () => chain,
          order: () => chain,
          insert: async (rows: typeof tasks) => {
            tasks.push(...rows);
            return { error: null };
          },
          then: (resolve: (v: unknown) => void) => {
            const ids = q.in as string[];
            if (table === "tenants") return resolve({ data: ids.map((id) => ({ id, license_no: null })), error: null });
            if (table === "tasks") return resolve({ data: tasks.filter((t) => ids.includes(t.tenant_id) && t.title === LICENSE_SETUP_TASK_TITLE), error: null });
            return resolve({ data: ids.map((id) => ({ id: `owner-${id}`, tenant_id: id })), error: null });
          },
        };
        return chain;
      },
    } as unknown as SupabaseClient;

    const first = await runLicenseSetupTasks(fake, ["a", "b"], 0);
    expect(first).toEqual({ opened: 2, closed: 0, failed: 0 });
    expect(tasks.map((t) => t.assigned_to)).toEqual(["owner-a", "owner-b"]);
    const second = await runLicenseSetupTasks(fake, ["a", "b"], 0);
    expect(second).toEqual({ opened: 0, closed: 0, failed: 0 });
    expect(tasks).toHaveLength(2);
  });

  it("numara girilince açık kurulum görevi kapanır; başka başlıklı ya da bitmiş görev etkilenmez", async () => {
    type T = { id: string; tenant_id: string; title: string; status: string; completed_at: string | null };
    const tasks: T[] = [
      { id: "k1", tenant_id: "a", title: LICENSE_SETUP_TASK_TITLE, status: "open", completed_at: null },
      { id: "k2", tenant_id: "a", title: "Başka görev", status: "open", completed_at: null },
      { id: "k3", tenant_id: "b", title: LICENSE_SETUP_TASK_TITLE, status: "open", completed_at: null },
    ];
    const license: Record<string, string | null> = { a: "3401234", b: null };
    const fake = {
      from(table: string) {
        const q: { in?: string[]; eq: Record<string, string>; patch?: Partial<T> } = { eq: {} };
        const matches = () =>
          tasks.filter((t) => q.in!.includes(t.tenant_id) && Object.entries(q.eq).every(([k, v]) => t[k as keyof T] === v));
        const chain = {
          select: () => chain,
          in: (_c: string, v: string[]) => ((q.in = v), chain),
          eq: (c: string, v: string) => ((q.eq[c] = v), chain),
          order: () => chain,
          update: (patch: Partial<T>) => ((q.patch = patch), chain),
          insert: async () => ({ error: null }),
          then: (resolve: (v: unknown) => void) => {
            const ids = q.in as string[];
            if (table === "tenants") return resolve({ data: ids.map((id) => ({ id, license_no: license[id] ?? null })), error: null });
            if (table === "tasks" && q.patch) {
              const hit = matches();
              for (const t of hit) Object.assign(t, q.patch);
              return resolve({ data: hit.map((t) => ({ id: t.id })), error: null });
            }
            if (table === "tasks") return resolve({ data: matches(), error: null });
            return resolve({ data: ids.map((id) => ({ id: `owner-${id}`, tenant_id: id })), error: null });
          },
        };
        return chain;
      },
    } as unknown as SupabaseClient;

    const r = await runLicenseSetupTasks(fake, ["a", "b"], Date.UTC(2026, 9, 13));
    expect(r).toEqual({ opened: 0, closed: 1, failed: 0 });
    expect(tasks.find((t) => t.id === "k1")).toMatchObject({ status: "done", completed_at: "2026-10-13T00:00:00.000Z" });
    expect(tasks.find((t) => t.id === "k2")?.status).toBe("open");
    expect(tasks.find((t) => t.id === "k3")?.status).toBe("open");
  });
});
