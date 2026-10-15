/**
 * Ofis raporları — satış hattı: randevu, görev, teklif, anlaşma, komisyon, komisyon ödemesi, onay, arama.
 */
import { DEFAULT_DEFINITIONS } from "@/lib/definition-defaults";
import { commissionShares } from "@/lib/export-entities";
import { now, trDayKey } from "@/lib/clock";
import { getStageLabels } from "@/lib/definitions";
import { defaultStageLabels, stageLabelMap } from "@/lib/deal-stage-labels";
import { DEAL_STAGES } from "@/lib/workflow-state";
import { DATE_RANGE_FIELDS } from "../filters";
import { loadDefLabels, memoLabels, STATUS } from "../labels";
import { applyActorScope, applyTimestampRange, chainEnrich, enrichProfiles, label, nameOf, one } from "../query-helpers";
import type { Row } from "../types";
import { ADVISOR_FILTER, defineReport, opts, tid } from "./define";

export const randevular = defineReport({
  id: "randevular",
  title: "Randevular",
  description: "Yer gösterme, ofis görüşmesi ve imza randevuları: müşteri, portföy, durum ve sonuç.",
  category: "satis",
  scope: "tenant",
  module: "appointments",
  personalData: true,
  keywords: ["yer gösterme", "takvim", "görüşme"],
  filters: [
    { kind: "select", key: "tip", label: "Randevu türü", options: DEFAULT_DEFINITIONS.appointment_type.map((d) => ({ value: d.value, label: d.label })) },
    { kind: "select", key: "durum", label: "Durum", options: opts(STATUS.appointment) },
    ADVISOR_FILTER,
    ...DATE_RANGE_FIELDS("Randevu başlangıcı", "Randevu bitişi"),
  ],
  columns: [
    { key: "tarih", label: "Randevu zamanı", type: "datetime", get: (r) => r.scheduled_at },
    { key: "tur", label: "Tür", type: "text", width: 16, get: (r, c) => label(memoLabels(c, "appointment_type"), r.appointment_type) },
    { key: "sure", label: "Süre (dk)", type: "number", get: (r) => r.duration_min },
    { key: "musteri", label: "Müşteri", type: "text", width: 24, get: (r) => one(r.customer)?.full_name },
    { key: "kod", label: "Portföy kodu", type: "text", width: 14, get: (r) => one(r.property)?.property_code },
    { key: "portfoy", label: "Portföy", type: "text", width: 30, get: (r) => one(r.property)?.title },
    { key: "konum", label: "Konum", type: "text", width: 24, get: (r) => r.location },
    { key: "durum", label: "Durum", type: "text", width: 14, get: (r) => label(STATUS.appointment, r.status) },
    { key: "sonuc", label: "Sonuç", type: "text", width: 20, get: (r) => r.outcome },
    { key: "danisman", label: "Danışman", type: "text", width: 20, get: (r, c) => nameOf(c, r.assigned_to) },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("appointments")
        .select(
          "id, appointment_type, scheduled_at, duration_min, location, status, outcome, assigned_to, customer:customers!appointments_customer_id_fkey(full_name, tenant_id), property:properties!appointments_property_id_fkey(property_code, title, tenant_id)",
          { count: "exact" },
        )
        .eq("tenant_id", tid(ctx))
        .eq("customer.tenant_id", tid(ctx))
        .eq("property.tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { sample: true, actorColumn: "assigned_to" });
      if (f.tip) q = q.eq("appointment_type", f.tip);
      if (f.durum) q = q.eq("status", f.durum);
      if (f.advisor) q = q.eq("assigned_to", f.advisor);
      q = applyTimestampRange(q, "scheduled_at", f);
      return q.order("scheduled_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: async (rows, ctx) => {
      await loadDefLabels(ctx, "appointment_type");
      await enrichProfiles((r) => [r.assigned_to])(rows, ctx);
    },
  },
});

export const gorevler = defineReport({
  id: "gorevler",
  title: "Görevler",
  description: "Görev listesi: tür, öncelik, vade, tamamlanma, atanan kişi ve geciken görevler.",
  category: "satis",
  scope: "tenant",
  module: "tasks",
  personalData: true,
  keywords: ["takip", "yapılacak", "gecikmiş"],
  filters: [
    { kind: "select", key: "durum", label: "Durum", options: opts(STATUS.task) },
    { kind: "select", key: "tur", label: "Tür", options: opts(STATUS.taskKind) },
    { kind: "select", key: "oncelik", label: "Öncelik", options: opts(STATUS.priority) },
    { kind: "select", key: "gecikmis", label: "Gecikme", options: [{ value: "evet", label: "Yalnız geciken (açık ve vadesi geçmiş)" }] },
    ADVISOR_FILTER,
    ...DATE_RANGE_FIELDS("Vade başlangıcı", "Vade bitişi"),
  ],
  columns: [
    { key: "baslik", label: "Görev", type: "text", width: 34, get: (r) => r.title },
    { key: "tur", label: "Tür", type: "text", width: 12, get: (r) => label(STATUS.taskKind, r.kind) },
    { key: "oncelik", label: "Öncelik", type: "text", width: 10, get: (r) => label(STATUS.priority, r.priority) },
    { key: "durum", label: "Durum", type: "text", width: 12, get: (r) => label(STATUS.task, r.status) },
    { key: "vade", label: "Vade", type: "datetime", get: (r) => r.due_at },
    { key: "gecikme", label: "Gecikme (gün)", type: "number", get: (r) => (r.status === "open" && r.due_at && Date.parse(r.due_at) < now() ? Math.floor((now() - Date.parse(r.due_at)) / 86_400_000) : null) },
    { key: "tamam", label: "Tamamlanma", type: "datetime", get: (r) => r.completed_at },
    { key: "tekrar", label: "Tekrar", type: "text", width: 14, get: (r) => label(STATUS.recurrence, r.recurrence) },
    { key: "atanan", label: "Atanan", type: "text", width: 20, get: (r, c) => nameOf(c, r.assigned_to) },
    { key: "musteri", label: "Müşteri", type: "text", width: 22, get: (r) => one(r.customer)?.full_name },
    { key: "kayit", label: "Oluşturma", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("tasks")
        .select("id, title, kind, priority, status, due_at, completed_at, recurrence, assigned_to, created_at, customer:customers!tasks_customer_id_fkey(full_name, tenant_id)", { count: "exact" })
        .eq("tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { sample: true, actorColumn: "assigned_to" });
      if (f.durum) q = q.eq("status", f.durum);
      if (f.tur) q = q.eq("kind", f.tur);
      if (f.oncelik) q = q.eq("priority", f.oncelik);
      if (f.gecikmis === "evet") q = q.eq("status", "open").lt("due_at", new Date(now()).toISOString());
      if (f.advisor) q = q.eq("assigned_to", f.advisor);
      q = applyTimestampRange(q, "due_at", f);
      return q.order("due_at", { ascending: true, nullsFirst: false }).order("id", { ascending: true });
    },
    enrich: enrichProfiles((r) => [r.assigned_to]),
  },
});

export const teklifler = defineReport({
  id: "teklifler",
  title: "Teklifler",
  description: "Verilen ve alınan teklifler: tutar, karşı teklif, geçerlilik, yanıt durumu.",
  category: "satis",
  scope: "tenant",
  module: "offers",
  personalData: true,
  keywords: ["pazarlık", "karşı teklif"],
  filters: [{ kind: "select", key: "durum", label: "Durum", options: opts(STATUS.offer) }, ADVISOR_FILTER, ...DATE_RANGE_FIELDS()],
  columns: [
    { key: "kod", label: "Portföy kodu", type: "text", width: 14, get: (r) => one(r.property)?.property_code },
    { key: "portfoy", label: "Portföy", type: "text", width: 30, get: (r) => one(r.property)?.title },
    { key: "musteri", label: "Müşteri", type: "text", width: 24, get: (r) => one(r.customer)?.full_name },
    { key: "tutar", label: "Teklif tutarı", type: "money", total: true, get: (r) => r.amount },
    { key: "karsi", label: "Karşı teklif", type: "money", get: (r) => r.counter_amount },
    { key: "durum", label: "Durum", type: "text", width: 16, get: (r) => label(STATUS.offer, r.status) },
    { key: "gecerlilik", label: "Geçerlilik", type: "date", get: (r) => r.valid_until },
    { key: "sunulma", label: "Sunulma", type: "datetime", get: (r) => r.submitted_at },
    { key: "yanit", label: "Yanıt", type: "datetime", get: (r) => r.responded_at },
    { key: "hazirlayan", label: "Hazırlayan", type: "text", width: 20, get: (r, c) => nameOf(c, r.created_by) },
    { key: "kayit", label: "Oluşturma", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("offers")
        .select(
          "id, amount, counter_amount, status, valid_until, submitted_at, responded_at, created_by, created_at, property:properties!offers_property_id_fkey(property_code, title, tenant_id), customer:customers!offers_customer_id_fkey(full_name, tenant_id)",
          { count: "exact" },
        )
        .eq("tenant_id", tid(ctx))
        .eq("property.tenant_id", tid(ctx))
        .eq("customer.tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { sample: true, actorColumn: "created_by" });
      if (f.durum) q = q.eq("status", f.durum);
      if (f.advisor) q = q.eq("created_by", f.advisor);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichProfiles((r) => [r.created_by]),
  },
});

export const anlasmalar = defineReport({
  id: "anlasmalar",
  title: "Anlaşmalar (satış hattı)",
  description: "Anlaşma hattı: aşama, değer, olasılık, müşteri, portföy, danışman ve kayıp nedeni.",
  category: "satis",
  customFields: "deal",
  scope: "tenant",
  module: "commissions",
  personalData: true,
  keywords: ["pipeline", "huni", "satış", "kayıp"],
  filters: [
    { kind: "select", key: "asama", label: "Aşama", options: DEAL_STAGES.map((s) => ({ value: s, label: stageLabelMap(defaultStageLabels())[s] ?? s })) },
    { kind: "select", key: "tur", label: "Anlaşma türü", options: opts(STATUS.dealType) },
    ADVISOR_FILTER,
    ...DATE_RANGE_FIELDS("Oluşturma başlangıcı", "Oluşturma bitişi"),
  ],
  columns: [
    { key: "asama", label: "Aşama", type: "text", width: 14, get: (r, c) => label((c.memo.get("stageNames") as Record<string, string>) ?? {}, r.stage) },
    { key: "tur", label: "Tür", type: "text", width: 12, get: (r) => label(STATUS.dealType, r.deal_type) },
    { key: "deger", label: "Anlaşma değeri", type: "money", decimals: 0, total: true, get: (r) => r.deal_value },
    { key: "olasilik", label: "Olasılık", type: "percent", decimals: 0, get: (r) => r.probability },
    { key: "musteri", label: "Müşteri", type: "text", width: 24, get: (r) => one(r.customer)?.full_name },
    { key: "kod", label: "Portföy kodu", type: "text", width: 14, get: (r) => one(r.property)?.property_code },
    { key: "portfoy", label: "Portföy", type: "text", width: 30, get: (r) => one(r.property)?.title },
    { key: "danisman", label: "Danışman", type: "text", width: 20, get: (r, c) => nameOf(c, r.assigned_to) },
    { key: "kayip", label: "Kayıp nedeni", type: "text", width: 22, get: (r, c) => label(memoLabels(c, "loss_reason"), r.loss_reason) },
    { key: "kayit", label: "Oluşturma", type: "date", get: (r) => r.created_at },
    { key: "guncelleme", label: "Son güncelleme", type: "date", get: (r) => r.updated_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("deals")
        .select(
          "id, stage, deal_type, deal_value, probability, loss_reason, assigned_to, created_at, updated_at, property:properties!deals_property_id_fkey(property_code, title, tenant_id), customer:customers!deals_customer_id_fkey(full_name, tenant_id)",
          { count: "exact" },
        )
        .eq("tenant_id", tid(ctx))
        .eq("property.tenant_id", tid(ctx))
        .eq("customer.tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { sample: true, actorColumn: "assigned_to" });
      if (f.asama) q = q.eq("stage", f.asama);
      if (f.tur) q = q.eq("deal_type", f.tur);
      if (f.advisor) q = q.eq("assigned_to", f.advisor);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("updated_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: chainEnrich(
      async (_rows, ctx) => {
        if (!ctx.memo.has("stageNames")) ctx.memo.set("stageNames", stageLabelMap(await getStageLabels()));
        await loadDefLabels(ctx, "loss_reason");
      },
      enrichProfiles((r) => [r.assigned_to]),
    ),
  },
});

export const komisyonlar = defineReport({
  id: "komisyonlar",
  title: "Komisyonlar",
  description: "Komisyon kayıtları: brüt tutar, KDV, danışman ve ofis payı, tahsilat durumu. Kazanç gizliliği uygulanır.",
  category: "finans",
  scope: "tenant",
  module: "commissions",
  earnings: true,
  personalData: true,
  keywords: ["tahakkuk", "tahsil", "danışman payı", "ofis payı"],
  filters: [{ kind: "select", key: "durum", label: "Durum", options: opts(STATUS.commission) }, ADVISOR_FILTER, ...DATE_RANGE_FIELDS()],
  columns: [
    { key: "kod", label: "Portföy kodu", type: "text", width: 14, get: (r) => one(one(r.deal)?.property)?.property_code },
    { key: "portfoy", label: "Portföy", type: "text", width: 30, get: (r) => one(one(r.deal)?.property)?.title },
    { key: "danisman", label: "Danışman", type: "text", width: 20, get: (r, c) => nameOf(c, one(r.deal)?.assigned_to) },
    { key: "brut", label: "Brüt komisyon", type: "money", total: true, get: (r) => r.gross_amount },
    { key: "kdv", label: "KDV", type: "money", total: true, get: (r) => r.vat_amount },
    { key: "dpay", label: "Danışman payı", type: "money", total: true, get: (r) => commissionShares(r.splits).advisor },
    { key: "opay", label: "Ofis payı", type: "money", total: true, get: (r) => commissionShares(r.splits).office },
    { key: "durum", label: "Tahsilat durumu", type: "text", width: 16, get: (r) => label(STATUS.commission, r.status) },
    { key: "kayit", label: "Kayıt tarihi", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("commissions")
        .select(
          "id, gross_amount, vat_amount, status, splits, created_at, deal:deals!commissions_deal_id_fkey!inner(tenant_id, assigned_to, property:properties!deals_property_id_fkey(property_code, title))",
          { count: "exact" },
        )
        .eq("tenant_id", tid(ctx))
        .eq("deal.tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { sample: true, actorColumn: "deal.assigned_to", earnings: true });
      if (f.durum) q = q.eq("status", f.durum);
      if (f.advisor) q = q.eq("deal.assigned_to", f.advisor);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichProfiles((r) => [one(r.deal as Row | null)?.assigned_to]),
  },
});

export const komisyonOdemeleri = defineReport({
  id: "komisyon-odemeleri",
  title: "Komisyon ödemeleri (danışman payı)",
  description: "Danışmanlara yapılan / bekleyen pay ödemeleri: tutar, onay, ödeme tarihi ve referansı. Kazanç gizliliği uygulanır.",
  category: "finans",
  scope: "tenant",
  module: "commissions",
  earnings: true,
  keywords: ["hakediş", "prim", "ödeme"],
  filters: [{ kind: "select", key: "durum", label: "Durum", options: opts(STATUS.payout) }, ADVISOR_FILTER, ...DATE_RANGE_FIELDS("Oluşturma başlangıcı", "Oluşturma bitişi")],
  columns: [
    { key: "danisman", label: "Danışman", type: "text", width: 22, get: (r, c) => nameOf(c, r.profile_id) },
    { key: "tutar", label: "Tutar", type: "money", total: true, get: (r) => r.amount },
    { key: "durum", label: "Durum", type: "text", width: 14, get: (r) => label(STATUS.payout, r.status) },
    { key: "onay", label: "Onay tarihi", type: "date", get: (r) => r.approved_at },
    { key: "onaylayan", label: "Onaylayan", type: "text", width: 20, get: (r, c) => nameOf(c, r.approved_by) },
    { key: "odeme", label: "Ödeme tarihi", type: "date", get: (r) => r.paid_at },
    { key: "odeyen", label: "Ödemeyi yapan", type: "text", width: 20, get: (r, c) => nameOf(c, r.paid_by) },
    { key: "ref", label: "Ödeme referansı", type: "text", width: 20, get: (r) => r.payment_ref },
    { key: "not", label: "Not", type: "text", width: 28, get: (r) => r.notes },
    { key: "kayit", label: "Oluşturma", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("commission_payouts")
        .select("id, profile_id, amount, status, approved_at, approved_by, paid_at, paid_by, payment_ref, notes, created_at", { count: "exact" })
        .eq("tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { actorColumn: "profile_id", earnings: true });
      if (f.durum) q = q.eq("status", f.durum);
      if (f.advisor) q = q.eq("profile_id", f.advisor);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichProfiles((r) => [r.profile_id, r.approved_by, r.paid_by]),
  },
});

export const onaylar = defineReport({
  id: "onaylar",
  title: "Onay talepleri",
  description: "Komisyon indirimi, gider, fiyat değişikliği gibi onay talepleri: talep eden, karar veren, karar ve süre.",
  category: "ofis",
  scope: "tenant",
  module: "commissions",
  keywords: ["onay", "karar", "yönetici"],
  filters: [
    { kind: "select", key: "durum", label: "Durum", options: opts(STATUS.approval) },
    { kind: "select", key: "tur", label: "Tür", options: opts(STATUS.approvalKind) },
    { kind: "advisor", key: "talepEden", label: "Talep eden" },
    ...DATE_RANGE_FIELDS("Talep başlangıcı", "Talep bitişi"),
  ],
  columns: [
    { key: "tur", label: "Tür", type: "text", width: 20, get: (r) => label(STATUS.approvalKind, r.kind) },
    { key: "baslik", label: "Başlık", type: "text", width: 34, get: (r) => r.title },
    { key: "durum", label: "Durum", type: "text", width: 14, get: (r) => label(STATUS.approval, r.status) },
    { key: "mevcut", label: "Mevcut değer", type: "money", get: (r) => r.current_value },
    { key: "talep", label: "Talep edilen değer", type: "money", get: (r) => r.requested_value },
    { key: "talepEden", label: "Talep eden", type: "text", width: 20, get: (r, c) => nameOf(c, r.requested_by) },
    { key: "karar", label: "Karar veren", type: "text", width: 20, get: (r, c) => nameOf(c, r.decided_by) },
    { key: "kararTarihi", label: "Karar tarihi", type: "datetime", get: (r) => r.decided_at },
    { key: "kararNotu", label: "Karar notu", type: "text", width: 30, get: (r) => r.decision_note },
    { key: "kayit", label: "Talep tarihi", type: "datetime", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("approval_requests")
        .select("id, kind, title, status, current_value, requested_value, requested_by, decided_by, decided_at, decision_note, created_at", { count: "exact" })
        .eq("tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { actorColumn: "requested_by" });
      if (f.durum) q = q.eq("status", f.durum);
      if (f.tur) q = q.eq("kind", f.tur);
      if (f.talepEden) q = q.eq("requested_by", f.talepEden);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichProfiles((r) => [r.requested_by, r.decided_by]),
  },
});

const CALL_DIRECTION: Record<string, string> = { inbound: "Gelen", outbound: "Giden", missed: "Cevapsız" };

export const aramalar = defineReport({
  id: "aramalar",
  title: "Çağrı kayıtları",
  description: "Gelen, giden ve cevapsız çağrılar: süre, sonuç, müşteri ve ilgilenen kişi.",
  category: "satis",
  scope: "tenant",
  module: "calls",
  personalData: true,
  keywords: ["telefon", "arama", "cevapsız"],
  filters: [{ kind: "select", key: "yon", label: "Yön", options: opts(CALL_DIRECTION) }, { kind: "advisor", key: "advisor", label: "İlgilenen" }, ...DATE_RANGE_FIELDS("Çağrı başlangıcı", "Çağrı bitişi")],
  columns: [
    { key: "tarih", label: "Çağrı zamanı", type: "datetime", get: (r) => r.started_at },
    { key: "yon", label: "Yön", type: "text", width: 10, get: (r) => label(CALL_DIRECTION, r.direction) },
    { key: "telefon", label: "Telefon", type: "text", width: 16, get: (r) => r.phone },
    { key: "musteri", label: "Müşteri", type: "text", width: 24, get: (r) => one(r.customer)?.full_name },
    { key: "sure", label: "Süre (sn)", type: "number", total: true, get: (r) => r.duration_sec },
    { key: "sonuc", label: "Sonuç", type: "text", width: 20, get: (r) => r.disposition },
    { key: "ilgilenen", label: "İlgilenen", type: "text", width: 20, get: (r, c) => nameOf(c, r.handled_by) },
    { key: "not", label: "Not", type: "text", width: 30, get: (r) => r.notes },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("calls")
        .select("id, direction, phone, duration_sec, disposition, notes, handled_by, started_at, customer:customers!calls_customer_id_fkey(full_name, tenant_id)", { count: "exact" })
        .eq("tenant_id", tid(ctx))
        .eq("customer.tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { sample: true, actorColumn: "handled_by" });
      if (f.yon) q = q.eq("direction", f.yon);
      if (f.advisor) q = q.eq("handled_by", f.advisor);
      q = applyTimestampRange(q, "started_at", f);
      return q.order("started_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichProfiles((r) => [r.handled_by]),
  },
});

/**
 * OA2: Satış hunisi — dönemde kaydedilen müşteri kohortu kaynağa göre (randevu → teklif → kazanılan → komisyon, kaynak maliyeti).
 * Kaynak `report_sales_funnel` (20261018080002; SECURITY INVOKER: kiracı + kayıt kapsamı RLS'te). Ofis geneli olmayan
 * görüntüleyende danışman kendisine kilitlenir; komisyon yalnız earnings_all, maliyet yalnız expenses:view ile dolu gelir.
 */
export const satisHunisi = defineReport({
  id: "satis-hunisi",
  title: "Satış hunisi (aşama dönüşümü)",
  description: "Dönemde kaydedilen müşteriler kaynağa göre: randevu, teklif ve kazanılan anlaşmaya dönüşüm oranları, ciro, komisyon ve kaynak maliyeti.",
  category: "satis",
  scope: "tenant",
  module: "reports",
  keywords: ["huni", "dönüşüm", "kaynak", "roi", "getiri", "maliyet"],
  filters: [ADVISOR_FILTER, ...DATE_RANGE_FIELDS("Müşteri kaydı başlangıcı", "Müşteri kaydı bitişi")],
  columns: [
    { key: "kaynak", label: "Kaynak", type: "text", width: 22, get: (r) => r.source_label },
    { key: "musteri", label: "Yeni müşteri sayısı", type: "number", total: true, get: (r) => r.customers },
    { key: "randevu", label: "Randevuya ulaşan", type: "number", total: true, get: (r) => r.appointments },
    { key: "randevuOran", label: "Randevu oranı", type: "percent", decimals: 1, get: (r) => pctOf(r.appointments, r.customers) },
    { key: "teklif", label: "Teklife ulaşan", type: "number", total: true, get: (r) => r.offers },
    { key: "teklifOran", label: "Teklif oranı", type: "percent", decimals: 1, get: (r) => pctOf(r.offers, r.customers) },
    { key: "kazanilan", label: "Kazanılan", type: "number", total: true, get: (r) => r.won },
    { key: "kazanmaOran", label: "Kazanma oranı", type: "percent", decimals: 1, get: (r) => pctOf(r.won, r.customers) },
    { key: "ciro", label: "Kazanılan ciro", type: "money", decimals: 0, total: true, get: (r) => r.won_value },
    { key: "komisyon", label: "Komisyon (brüt)", type: "money", decimals: 0, total: true, get: (r) => r.commission },
    { key: "maliyet", label: "Kaynak maliyeti", type: "money", decimals: 0, total: true, get: (r) => r.cost },
    { key: "medyan", label: "Kazanmaya medyan gün", type: "number", get: (r) => r.median_days_to_won },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      const today = trDayKey(now());
      const from = typeof f.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.from) ? f.from : `${today.slice(0, 7)}-01`;
      const to = typeof f.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.to) ? f.to : today;
      const profile = ctx.officeWide ? (typeof f.advisor === "string" && f.advisor ? f.advisor : null) : ctx.userId;
      const { data, error } = await ctx.supabase.rpc("report_sales_funnel", {
        p_from: from <= to ? from : to,
        p_to: from <= to ? to : from,
        p_branch: null,
        p_team: null,
        p_profile: profile,
      });
      if (error) throw error;
      const sources = ((data as { sources?: Row[] } | null)?.sources ?? []) as Row[];
      await loadDefLabels(ctx, "customer_source");
      const labels = memoLabels(ctx, "customer_source");
      return sources.map((r) => ({ ...r, source_label: r.source === "Belirtilmedi" ? "Belirtilmedi" : label(labels, r.source) }));
    },
  },
});

/** SP1: Anlaşma aşama geçmişi — eklemeli `deal_stage_events` (kim, ne zaman, hangi aşamadan hangisine). */
export const anlasmaAsamaGecmisi = defineReport({
  id: "anlasma-asama-gecmisi",
  title: "Anlaşma aşama geçmişi",
  description: "Her aşama değişikliği: anlaşma, önceki ve yeni aşama, değiştiren kişi ve tarih. Satış hızı ve aşama süresi analizinin ham verisi.",
  category: "satis",
  scope: "tenant",
  module: "commissions",
  keywords: ["aşama", "geçmiş", "pipeline", "satış hızı", "değişiklik"],
  filters: [ADVISOR_FILTER, ...DATE_RANGE_FIELDS("Değişiklik başlangıcı", "Değişiklik bitişi")],
  columns: [
    { key: "tarih", label: "Değişiklik zamanı", type: "datetime", get: (r) => r.changed_at },
    { key: "kod", label: "Portföy kodu", type: "text", width: 14, get: (r) => one(one(r.deal)?.property)?.property_code },
    { key: "portfoy", label: "Portföy", type: "text", width: 30, get: (r) => one(one(r.deal)?.property)?.title },
    { key: "onceki", label: "Önceki aşama", type: "text", width: 16, get: (r, c) => (r.from_stage ? label((c.memo.get("stageNames") as Record<string, string>) ?? {}, r.from_stage) : "Oluşturuldu") },
    { key: "yeni", label: "Yeni aşama", type: "text", width: 16, get: (r, c) => label((c.memo.get("stageNames") as Record<string, string>) ?? {}, r.to_stage) },
    { key: "degistiren", label: "Değiştiren", type: "text", width: 20, get: (r, c) => nameOf(c, r.changed_by) },
    { key: "danisman", label: "Anlaşma danışmanı", type: "text", width: 20, get: (r, c) => nameOf(c, one(r.deal)?.assigned_to) },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("deal_stage_events")
        .select(
          "id, from_stage, to_stage, changed_by, changed_at, deal:deals!deal_stage_events_deal_id_fkey!inner(assigned_to, tenant_id, property:properties!deals_property_id_fkey(property_code, title, tenant_id))",
          { count: "exact" },
        )
        .eq("tenant_id", tid(ctx))
        .eq("deal.tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { sample: true, actorColumn: "deal.assigned_to" });
      if (f.advisor) q = q.eq("deal.assigned_to", f.advisor);
      q = applyTimestampRange(q, "changed_at", f);
      return q.order("changed_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: chainEnrich(
      async (_rows, ctx) => {
        if (!ctx.memo.has("stageNames")) ctx.memo.set("stageNames", stageLabelMap(await getStageLabels()));
      },
      enrichProfiles((r) => [r.changed_by, one(r.deal)?.assigned_to]),
    ),
  },
});

function pctOf(part: unknown, whole: unknown): number | null {
  const w = Number(whole);
  return w > 0 ? Math.round((Number(part) / w) * 1000) / 10 : null;
}

export const SALES_REPORTS = [randevular, gorevler, teklifler, anlasmalar, satisHunisi, anlasmaAsamaGecmisi, komisyonlar, komisyonOdemeleri, onaylar, aramalar];
