import { describe, expect, it, vi } from "vitest";
import {
  STALE_MESSAGE,
  canSave,
  changedKeys,
  initRowDraft,
  isDirty,
  isLocked,
  rowDraftReducer,
  type RowDraftAction,
  type RowDraftState,
} from "./row-draft";
import { createRowDraftStore, unsavedSummary } from "./row-draft-store";

type Row = { plan: string; status: string };
const base: Row = { plan: "office", status: "active" };
const run = (s: RowDraftState<Row>, ...actions: RowDraftAction<Row>[]) => actions.reduce(rowDraftReducer<Row>, s);

describe("satır taslağı: kirli = değer karşılaştırması", () => {
  it("başlangıçta temiz ve Kaydet pasif", () => {
    const s = initRowDraft(base, "v1");
    expect(isDirty(s)).toBe(false);
    expect(canSave(s)).toBe(false);
  });

  it("değişiklik kirletir, aynı değere dönmek yeniden temizler (tıklama sayılmaz)", () => {
    const a = run(initRowDraft(base), { type: "set", key: "plan", value: "professional" });
    expect(isDirty(a)).toBe(true);
    expect(canSave(a)).toBe(true);
    expect(changedKeys(a.saved, a.draft)).toEqual(["plan"]);
    const b = run(a, { type: "set", key: "plan", value: "office" });
    expect(isDirty(b)).toBe(false);
    expect(canSave(b)).toBe(false);
  });

  it("geçersiz seçimde Kaydet pasif", () => {
    const a = run(initRowDraft(base), { type: "set", key: "status", value: "suspended" });
    expect(canSave(a, { ok: false, reason: "Askıdaki ofise paket atanamaz" })).toBe(false);
  });
});

describe("kaydetme akışı", () => {
  it("kaydederken kilitli, çift gönderim ve değişiklik yok sayılır", () => {
    const s = run(initRowDraft(base), { type: "set", key: "plan", value: "professional" }, { type: "submit" });
    expect(s.status).toBe("saving");
    expect(isLocked(s)).toBe(true);
    expect(canSave(s)).toBe(false);
    expect(run(s, { type: "submit" })).toBe(s);
    expect(run(s, { type: "set", key: "plan", value: "advisor" })).toBe(s);
    expect(run(s, { type: "reset" })).toBe(s);
  });

  it("başarı: kayıtlı değer taslağa eşitlenir, kısa onay sonra boşta + pasif", () => {
    const s = run(initRowDraft(base, "v1"), { type: "set", key: "plan", value: "professional" }, { type: "submit" }, { type: "success", version: "v2" });
    expect(s.status).toBe("saved");
    expect(s.saved.plan).toBe("professional");
    expect(s.version).toBe("v2");
    expect(isDirty(s)).toBe(false);
    expect(canSave(s)).toBe(false);
    expect(run(s, { type: "settle" }).status).toBe("idle");
  });

  it("hata: taslak korunur, Kaydet tekrar aktif, değişiklik hatayı siler", () => {
    const s = run(initRowDraft(base), { type: "set", key: "plan", value: "professional" }, { type: "submit" }, { type: "failure", error: "Paket sınırı" });
    expect(s.status).toBe("error");
    expect(s.error).toBe("Paket sınırı");
    expect(s.draft.plan).toBe("professional");
    expect(canSave(s)).toBe(true);
    expect(run(s, { type: "set", key: "status", value: "trial" }).error).toBeNull();
  });

  it("vazgeç taslağı kayıtlı değere döndürür", () => {
    const s = run(initRowDraft(base), { type: "set", key: "plan", value: "professional" }, { type: "reset" });
    expect(s.draft).toEqual(base);
    expect(isDirty(s)).toBe(false);
  });

  it("riskli değişiklik: onay adımı, değişiklik ya da Esc onayı düşürür", () => {
    const a = run(initRowDraft(base), { type: "set", key: "status", value: "suspended" }, { type: "confirm" });
    expect(a.status).toBe("confirming");
    expect(run(a, { type: "cancelConfirm" }).status).toBe("idle");
    expect(run(a, { type: "set", key: "plan", value: "advisor" }).status).toBe("idle");
    // Temiz satırda onay adımı açılmaz.
    expect(run(initRowDraft(base), { type: "confirm" }).status).toBe("idle");
  });
});

describe("sunucu eşitleme ve bayat satır", () => {
  it("temiz satır yeni sunucu değerini benimser", () => {
    const s = run(initRowDraft(base, "v1"), { type: "sync", saved: { plan: "advisor", status: "trial" }, version: "v2" });
    expect(s.draft).toEqual({ plan: "advisor", status: "trial" });
    expect(s.version).toBe("v2");
    expect(s.staleVersion).toBeNull();
  });

  it("aynı sürüm + aynı değer (yeni nesne) durumu değiştirmez", () => {
    const s0 = run(initRowDraft(base, "v1"), { type: "set", key: "plan", value: "professional" });
    expect(run(s0, { type: "sync", saved: { ...base }, version: "v1" })).toBe(s0);
  });

  it("kirli satırın altında sunucu değişirse bayat: kayıt engellenir, yenile yeni değeri getirir", () => {
    const s = run(
      initRowDraft(base, "v1"),
      { type: "set", key: "plan", value: "professional" },
      { type: "sync", saved: { plan: "office", status: "past_due" }, version: "v2" },
    );
    expect(s.staleVersion).toBe("v2");
    expect(s.draft.plan).toBe("professional");
    expect(canSave(s)).toBe(false);
    const tried = run(s, { type: "submit" });
    expect(tried.status).toBe("error");
    expect(tried.error).toBe(STALE_MESSAGE);
    const fresh = run(s, { type: "refresh" });
    expect(fresh.draft).toEqual({ plan: "office", status: "past_due" });
    expect(fresh.version).toBe("v2");
    expect(canSave(fresh)).toBe(false);
  });

  it("kaydederken gelen yenileme beklenir; başarı sürümü yeniler", () => {
    const saving = run(initRowDraft(base, "v1"), { type: "set", key: "plan", value: "professional" }, { type: "submit" });
    expect(run(saving, { type: "sync", saved: { plan: "professional", status: "active" }, version: "v2" })).toBe(saving);
  });
});

describe("kirli satır kaydı (tablo çubuğu)", () => {
  it("sayar, tümünü sıralı kaydeder ve geri alır", async () => {
    const store = createRowDraftStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const order: string[] = [];
    const resetA = vi.fn();
    store.register("a", { label: "A", save: async () => void order.push("a"), reset: resetA });
    store.register("b", { label: "B", save: () => void order.push("b"), reset: vi.fn() });
    store.register("a", { label: "A", save: async () => void order.push("a2"), reset: resetA }); // güncelleme: yayın yok
    expect(store.getCount()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
    await store.saveAll();
    expect(order).toEqual(["a2", "b"]);
    store.resetAll();
    expect(resetA).toHaveBeenCalledOnce();
    store.unregister("a");
    store.unregister("a");
    expect(store.getCount()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(unsavedSummary(3)).toBe("3 satırda kaydedilmemiş değişiklik");
    expect(unsavedSummary(0)).toBe("");
  });
});
