import { describe, expect, it, vi } from "vitest";
import { APPROVAL_PENDING_MESSAGE } from "@/lib/oversight/approval-gate";
import { isSensitiveFieldName } from "@/lib/form-tabs";
import { activeSteps, runPlan, stepIssues } from "@/components/ui/wizard/engine";
import { encodeSplits } from "@/lib/sihirbaz/hesap";
import { LOST_DRAFT_FIELDS, WON_DRAFT_FIELDS, isApprovalPending, lostPlan, lostSteps, wonPlan, wonSteps, type WonContext } from "./kapanis-adimlar";

const ctx: WonContext = {
  dealId: "d1",
  dealType: "sale",
  propertyId: "p1",
  propertyTitle: "Moda 3+1",
  propertyStatusLabel: "Yayında",
  customerId: "c1",
  customerName: "Ayşe",
  dealValue: 5_000_000,
  commissionRate: 2,
  showMoney: true,
  canSetRate: true,
  canCreateTask: true,
  hasCollectionTask: false,
  needsApproval: false,
};
const good = { deal_value: "5.000.000", splits: encodeSplits([{ label: "Danışman", rate: "50" }, { label: "Ofis", rate: "50" }]), confirm_property: "1", due_at: "" };

function actions() {
  return {
    updateDeal: vi.fn(async (_fd: FormData) => ({ ok: true })),
    setRate: vi.fn(async () => ({ ok: true as const })),
    win: vi.fn(async (_fd: FormData) => ({ ok: true }) as { ok?: boolean; error?: string }),
    commissionId: vi.fn(async () => ({ id: "k1" })),
    saveSplits: vi.fn(async () => ({ ok: true }) as { ok?: boolean; error?: string }),
    createTask: vi.fn(async (_fd: FormData) => ({ ok: true })),
  };
}

describe("Satışı kapat adımları", () => {
  it("Nihai fiyat → Paylar → Portföy durumu → Sözleşme ve vade → Özet; para görünmüyorsa paylar yok", () => {
    expect(activeSteps(wonSteps(ctx), {}).map((s) => s.id)).toEqual(["tutar", "paylar", "portfoy", "belgeler", "ozet"]);
    expect(activeSteps(wonSteps({ ...ctx, showMoney: false }), {}).map((s) => s.id)).toEqual(["tutar", "portfoy", "belgeler", "ozet"]);
  });

  it("oran yoksa fiyat adımı oran ister; paylar %100'ü aşamaz; portföy onayı zorunlu", () => {
    const s = wonSteps({ ...ctx, commissionRate: null });
    expect(stepIssues(s[0], { deal_value: "5.000.000" }).map((i) => i.field)).toEqual(["wz-won-rate"]);
    expect(stepIssues(s[0], { deal_value: "5.000.000", commission_rate: "2" })).toEqual([]);
    const paylar = wonSteps(ctx)[1];
    expect(stepIssues(paylar, { splits: encodeSplits([{ label: "A", rate: "70" }, { label: "B", rate: "40" }]) })[0]?.message).toMatch(/aşamaz/);
    const portfoy = wonSteps(ctx)[2];
    expect(stepIssues(portfoy, { ...good, confirm_property: "" }).map((i) => i.field)).toEqual(["wz-won-confirm"]);
    expect(stepIssues(wonSteps({ ...ctx, dealType: "rent" })[2], good).map((i) => i.field)).toEqual(["wz-won-ready"]);
  });

  it("taslak alanları kişisel veri taşımaz", () => {
    for (const f of [...WON_DRAFT_FIELDS, ...LOST_DRAFT_FIELDS]) expect(isSensitiveFieldName(f), f).toBe(false);
  });
});

describe("Satışı kapat planı", () => {
  it("tutar değişmediyse yazılmaz; kazan → paylar; vade görevi isteğe bağlı", async () => {
    const a = actions();
    const tasks = wonPlan(good, new Set(), ctx, a);
    expect(tasks.map((t) => t.id)).toEqual(["kazan", "paylar"]);
    const res = await runPlan(tasks, { ctx: {}, done: [] });
    expect(res.status).toBe("done");
    expect(a.win.mock.calls[0][0].get("stage")).toBe("won");
    expect(a.saveSplits).toHaveBeenCalledWith("k1", [{ label: "Danışman", rate: 50 }, { label: "Ofis", rate: 50 }]);
    const withDue = wonPlan({ ...good, deal_value: "5.200.000", due_at: "2026-10-24T09:00" }, new Set(), { ...ctx, commissionRate: null }, a).map((t) => t.id);
    expect(withDue).toEqual(["tutar", "kazan", "paylar", "vade"]);
    expect(wonPlan({ ...good, due_at: "2026-10-24T09:00" }, new Set(["belgeler"]), ctx, a).map((t) => t.id)).toEqual(["kazan", "paylar"]);
  });

  it("WP2: danışman rolünde Kazanıldı onaya düşerse DURUM ('approval') olarak durur, paylar yazılmaz", async () => {
    const a = actions();
    a.win.mockResolvedValueOnce({ error: APPROVAL_PENDING_MESSAGE });
    const res = await runPlan(wonPlan(good, new Set(), { ...ctx, needsApproval: true }, a), { ctx: {}, done: [] });
    expect(res.status === "failed" && res.kind).toBe("approval");
    expect(a.saveSplits).not.toHaveBeenCalled();
    expect(isApprovalPending(APPROVAL_PENDING_MESSAGE)).toBe(true);
    expect(isApprovalPending("Komisyon kaydı bulunamadı.")).toBe(false);
  });

  it("paylaşım onaya düşerse kapanış tamamdır, not düşülür; gerçek hata yeniden denenebilir", async () => {
    const a = actions();
    a.saveSplits.mockResolvedValueOnce({ error: APPROVAL_PENDING_MESSAGE });
    const ok = await runPlan(wonPlan(good, new Set(), ctx, a), { ctx: {}, done: [] });
    expect(ok.status).toBe("done");
    expect(ok.notes[0]).toMatch(/onayına gönderildi/);

    const b = actions();
    b.saveSplits.mockResolvedValueOnce({ error: "Toplam oran %100'ü aşamaz." });
    const failed = await runPlan(wonPlan(good, new Set(), ctx, b), { ctx: {}, done: [] });
    expect(failed.status === "failed" && failed.failedId).toBe("paylar");
    if (failed.status !== "failed") return;
    const retry = await runPlan(wonPlan(good, new Set(), ctx, b), { ctx: failed.ctx, done: failed.done });
    expect(retry.status).toBe("done");
    expect(b.win).toHaveBeenCalledTimes(1); // kazanma tekrarlanmaz
  });
});

describe("Kaybedildi", () => {
  const lctx = { dealId: "d1", customerId: "c1", propertyId: "p1", canCreateTask: true };
  it("neden zorunlu, 'diger' açıklama ister; takip isteğe bağlı", () => {
    const s = lostSteps(lctx, (v) => v);
    expect(stepIssues(s[0], {}).map((i) => i.field)).toEqual(["wz-lost-reason"]);
    expect(stepIssues(s[0], { loss_reason: "diger" }).map((i) => i.field)).toEqual(["wz-lost-extra"]);
    expect(s[1].optional).toBe(true);
    expect(activeSteps(lostSteps({ ...lctx, canCreateTask: false }, (v) => v), {}).map((x) => x.id)).toEqual(["neden", "ozet"]);
  });
  it("plan: kaybet (neden + not) → takip görevi", async () => {
    const lose = vi.fn(async (_fd: FormData) => ({ ok: true }));
    const createTask = vi.fn(async (_fd: FormData) => ({ ok: true }));
    const v = { loss_reason: "fiyat", loss_competitor: "X Emlak", loss_price: "", loss_extra: "", takip: "1", takip_title: "Ara", takip_due: "2026-11-01T10:00" };
    const res = await runPlan(lostPlan(v, new Set(), lctx, { lose, createTask }), { ctx: {}, done: [] });
    expect(res.status).toBe("done");
    expect(lose.mock.calls[0][0].get("loss_reason")).toBe("fiyat");
    expect(lose.mock.calls[0][0].get("loss_note")).toBe("Rakip: X Emlak");
    expect(createTask.mock.calls[0][0].get("deal_id")).toBe("d1");
  });
});
