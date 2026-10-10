/**
 * Platform (yönetim) raporları — yalnız EmlakSoft personeli, departman modülüne göre.
 * Veri servis istemcisiyle okunur (`buildPlatformContext`); kiracılar arası okuma bu raporların işidir ve her satırda
 * ofis adı çözülür. Dosya içeriği kişisel veri (ad, telefon, e-posta) taşıyorsa `personalData` işaretlidir.
 */
import { auditActionLabel } from "@/lib/admin-format";
import { planLabel } from "@/lib/billing/plans";
import { defaultLabelMap } from "@/lib/definition-defaults";
import { now, trMonthKey } from "@/lib/clock";
import { formatPhoneDisplay } from "@/lib/phone";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { ROLE_LABELS } from "@/lib/role-labels";
import { DATE_RANGE_FIELDS } from "../filters";
import { STATUS } from "../labels";
import { applyTimestampRange, enrichStaff, enrichTenants, chainEnrich, label, nameOf, searchOr } from "../query-helpers";
import type { ReportColumn, ReportContext, Row } from "../types";
import { defineReport, opts } from "./define";

const PLAN_OPTIONS = ["advisor", "office", "professional", "business", "enterprise"].map((id) => ({ value: id, label: planLabel(id) }));

type TenantStats = { owner: string; active: number; total: number };

async function loadTenantStats(ctx: ReportContext, ids: string[]): Promise<void> {
  const stats = (ctx.memo.get("tenantUsers") as Map<string, TenantStats> | undefined) ?? new Map<string, TenantStats>();
  ctx.memo.set("tenantUsers", stats);
  const subs = (ctx.memo.get("tenantSubs") as Map<string, Row> | undefined) ?? new Map<string, Row>();
  ctx.memo.set("tenantSubs", subs);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const profiles = await fetchAllRows<Row>((from, to) =>
      ctx.supabase.from("profiles").select("id, tenant_id, full_name, role, is_active").in("tenant_id", chunk).order("id", { ascending: true }).range(from, to),
    );
    for (const p of profiles.data) {
      const cur = stats.get(p.tenant_id) ?? { owner: "", active: 0, total: 0 };
      cur.total += 1;
      if (p.is_active) cur.active += 1;
      if (p.role === "owner" && !cur.owner) cur.owner = p.full_name;
      stats.set(p.tenant_id, cur);
    }
    const { data: sub } = await ctx.supabase.from("subscriptions").select("tenant_id, status, amount_try, billing_cycle, extra_seats").in("tenant_id", chunk);
    for (const s of (sub ?? []) as Row[]) subs.set(s.tenant_id, s);
  }
}

export const ofisler = defineReport({
  id: "ofisler",
  title: "Ofisler",
  description: "Tüm ofisler: paket, durum, deneme bitişi, sahibi, kullanıcı sayısı, abonelik tutarı ve iletişim.",
  category: "platform",
  scope: "platform",
  platformModule: "tenants",
  personalData: true,
  keywords: ["tenant", "müşteri", "deneme", "kayıt"],
  filters: [
    { kind: "select", key: "plan", label: "Paket", options: PLAN_OPTIONS },
    { kind: "select", key: "durum", label: "Durum", options: opts(STATUS.tenantStatus) },
    { kind: "text", key: "q", label: "Ofis adı", placeholder: "Ofis adında ara" },
    ...DATE_RANGE_FIELDS("Kayıt başlangıcı", "Kayıt bitişi"),
  ],
  columns: [
    { key: "ofis", label: "Ofis", type: "text", width: 30, get: (r) => r.name },
    { key: "sahip", label: "Ofis sahibi", type: "text", width: 24, get: (r, c) => (c.memo.get("tenantUsers") as Map<string, TenantStats> | undefined)?.get(r.id)?.owner },
    { key: "telefon", label: "Telefon", type: "text", width: 16, get: (r) => formatPhoneDisplay(r.phone) },
    { key: "sehir", label: "Şehir", type: "text", width: 14, get: (r) => r.city },
    { key: "paket", label: "Paket", type: "text", width: 14, get: (r) => planLabel(r.plan) },
    { key: "durum", label: "Ofis durumu", type: "text", width: 12, get: (r) => label(STATUS.tenantStatus, r.status) },
    { key: "abonelik", label: "Abonelik durumu", type: "text", width: 16, get: (r, c) => label(STATUS.subscription, (c.memo.get("tenantSubs") as Map<string, Row> | undefined)?.get(r.id)?.status) },
    { key: "donem", label: "Faturalama", type: "text", width: 12, get: (r, c) => label(STATUS.billingCycle, (c.memo.get("tenantSubs") as Map<string, Row> | undefined)?.get(r.id)?.billing_cycle) },
    { key: "tutar", label: "Abonelik tutarı (TL)", type: "money", total: true, get: (r, c) => (c.memo.get("tenantSubs") as Map<string, Row> | undefined)?.get(r.id)?.amount_try },
    { key: "aktif", label: "Aktif kullanıcı", type: "number", total: true, get: (r, c) => (c.memo.get("tenantUsers") as Map<string, TenantStats> | undefined)?.get(r.id)?.active ?? 0 },
    { key: "toplam", label: "Toplam kullanıcı", type: "number", total: true, get: (r, c) => (c.memo.get("tenantUsers") as Map<string, TenantStats> | undefined)?.get(r.id)?.total ?? 0 },
    { key: "deneme", label: "Deneme bitişi", type: "date", get: (r) => r.trial_ends_at },
    { key: "kayit", label: "Kayıt tarihi", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase.from("tenants").select("id, name, plan, status, phone, city, trial_ends_at, created_at", { count: "exact" });
      if (f.plan) q = q.eq("plan", f.plan);
      if (f.durum) q = q.eq("status", f.durum);
      q = searchOr(q, ["name"], f.q);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: async (rows, ctx) => loadTenantStats(ctx, rows.map((r) => r.id)),
  },
});

export const uyeler = defineReport({
  id: "uyeler",
  title: "Üyeler (tüm kullanıcılar)",
  description: "Platformdaki tüm ofis kullanıcıları: ofis, rol, telefon, aktiflik ve kayıt tarihi.",
  category: "platform",
  scope: "platform",
  platformModule: "members",
  personalData: true,
  keywords: ["kullanıcı", "üye", "danışman"],
  filters: [
    { kind: "select", key: "rol", label: "Rol", options: opts(ROLE_LABELS) },
    { kind: "select", key: "durum", label: "Durum", options: [{ value: "aktif", label: "Aktif" }, { value: "pasif", label: "Pasif" }] },
    { kind: "text", key: "q", label: "Ad soyad", placeholder: "Ada göre ara" },
    ...DATE_RANGE_FIELDS("Kayıt başlangıcı", "Kayıt bitişi"),
  ],
  columns: [
    { key: "ad", label: "Ad soyad", type: "text", width: 26, get: (r) => r.full_name },
    { key: "ofis", label: "Ofis", type: "text", width: 28, get: (r, c) => nameOf(c, r.tenant_id) },
    { key: "rol", label: "Rol", type: "text", width: 16, get: (r) => label(ROLE_LABELS, r.role) },
    { key: "telefon", label: "Telefon", type: "text", width: 16, get: (r) => formatPhoneDisplay(r.phone) },
    { key: "aktif", label: "Aktif", type: "bool", get: (r) => r.is_active },
    { key: "kayit", label: "Kayıt tarihi", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase.from("profiles").select("id, tenant_id, full_name, phone, role, is_active, created_at", { count: "exact" });
      if (f.rol) q = q.eq("role", f.rol);
      if (f.durum) q = q.eq("is_active", f.durum === "aktif");
      q = searchOr(q, ["full_name"], f.q);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichTenants((r) => [r.tenant_id]),
  },
});

export const abonelikler = defineReport({
  id: "abonelikler",
  title: "Abonelikler",
  description: "Ofis abonelikleri: paket, durum, faturalama dönemi, tutar, ek koltuk, dönem bitişi, iptal ve duraklatma bilgisi.",
  category: "gelir",
  scope: "platform",
  platformModule: "billing",
  keywords: ["abonelik", "mrr", "plan", "yenileme"],
  filters: [
    { kind: "select", key: "plan", label: "Paket", options: PLAN_OPTIONS },
    { kind: "select", key: "durum", label: "Durum", options: opts(STATUS.subscription) },
    { kind: "select", key: "donem", label: "Faturalama", options: opts(STATUS.billingCycle) },
    ...DATE_RANGE_FIELDS("Oluşturma başlangıcı", "Oluşturma bitişi"),
  ],
  columns: [
    { key: "ofis", label: "Ofis", type: "text", width: 30, get: (r, c) => nameOf(c, r.tenant_id) },
    { key: "paket", label: "Paket", type: "text", width: 14, get: (r) => planLabel(r.plan) },
    { key: "durum", label: "Durum", type: "text", width: 14, get: (r) => label(STATUS.subscription, r.status) },
    { key: "donem", label: "Faturalama", type: "text", width: 12, get: (r) => label(STATUS.billingCycle, r.billing_cycle) },
    { key: "tutar", label: "Tutar (TL)", type: "money", total: true, get: (r) => r.amount_try },
    { key: "aylik", label: "Aylık eşdeğer (TL)", type: "money", total: true, get: (r) => (r.status === "active" ? (r.billing_cycle === "yearly" ? Number(r.amount_try) / 12 : Number(r.amount_try)) : null) },
    { key: "koltuk", label: "Ek koltuk", type: "number", total: true, get: (r) => r.extra_seats },
    { key: "bas", label: "Dönem başlangıcı", type: "date", get: (r) => r.current_period_start },
    { key: "bit", label: "Dönem bitişi", type: "date", get: (r) => r.current_period_end },
    { key: "deneme", label: "Deneme bitişi", type: "date", get: (r) => r.trial_ends_at },
    { key: "iptalTalebi", label: "Dönem sonunda iptal", type: "bool", get: (r) => r.cancel_at_period_end },
    { key: "iptalNedeni", label: "İptal nedeni", type: "text", width: 24, get: (r) => r.cancel_reason },
    { key: "duraklatma", label: "Duraklatıldı", type: "date", get: (r) => r.paused_at },
    { key: "bekleyenPlan", label: "Planlı paket değişimi", type: "text", width: 18, get: (r) => (r.pending_plan ? planLabel(r.pending_plan) : "") },
    { key: "kayit", label: "Oluşturma", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("subscriptions")
        .select("id, tenant_id, plan, status, billing_cycle, amount_try, extra_seats, current_period_start, current_period_end, trial_ends_at, cancel_at_period_end, cancel_reason, paused_at, pending_plan, created_at", { count: "exact" });
      if (f.plan) q = q.eq("plan", f.plan);
      if (f.durum) q = q.eq("status", f.durum);
      if (f.donem) q = q.eq("billing_cycle", f.donem);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichTenants((r) => [r.tenant_id]),
  },
});

export const faturalar = defineReport({
  id: "faturalar",
  title: "Faturalar ve tahsilat",
  description: "Tüm abonelik faturaları: durum, tutar, KDV, vade, ödeme tarihi ve hatırlatma sayısı.",
  category: "gelir",
  scope: "platform",
  platformModule: "billing",
  keywords: ["fatura", "tahsilat", "vade", "ödenmemiş"],
  filters: [
    { kind: "select", key: "durum", label: "Durum", options: opts(STATUS.invoice) },
    ...DATE_RANGE_FIELDS("Düzenleme başlangıcı", "Düzenleme bitişi"),
  ],
  columns: [
    { key: "no", label: "Fatura no", type: "text", width: 18, get: (r) => r.invoice_no },
    { key: "ofis", label: "Ofis", type: "text", width: 30, get: (r, c) => nameOf(c, r.tenant_id) },
    { key: "durum", label: "Durum", type: "text", width: 14, get: (r) => label(STATUS.invoice, r.status) },
    { key: "tutar", label: "Tutar", type: "money", total: true, get: (r) => r.amount_try },
    { key: "kdv", label: "KDV", type: "money", total: true, get: (r) => r.tax_try },
    { key: "toplam", label: "Toplam", type: "money", total: true, get: (r) => r.total_try },
    { key: "vade", label: "Vade", type: "date", get: (r) => r.due_at },
    { key: "odeme", label: "Ödeme tarihi", type: "date", get: (r) => r.paid_at },
    { key: "hatirlatma", label: "Hatırlatma sayısı", type: "number", get: (r) => r.reminder_count },
    { key: "kayit", label: "Düzenleme", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase.from("invoices").select("id, tenant_id, invoice_no, status, amount_try, tax_try, total_try, due_at, paid_at, reminder_count, created_at", { count: "exact" });
      if (f.durum) q = q.eq("status", f.durum);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichTenants((r) => [r.tenant_id]),
  },
});

export const odemeUyarilari = defineReport({
  id: "odeme-uyarilari",
  title: "Ödeme uyarıları (tahsilat yakalamaları)",
  description: "Ödeme sağlayıcıdan gelen tahsilatların işlenme durumu: bekleyen, elle inceleme, iade gerekli. Günlük kontrol edilmelidir.",
  category: "gelir",
  scope: "platform",
  platformModule: "billing",
  keywords: ["iyzico", "iade", "manuel inceleme", "tahsilat"],
  filters: [{ kind: "select", key: "durum", label: "Durum", options: opts(STATUS.captureStatus) }, ...DATE_RANGE_FIELDS("Yakalama başlangıcı", "Yakalama bitişi")],
  columns: [
    { key: "ofis", label: "Ofis", type: "text", width: 30, get: (r, c) => nameOf(c, r.tenant_id) },
    { key: "hedef", label: "Hedef", type: "text", width: 18, get: (r) => label(STATUS.captureTarget, r.target_type) },
    { key: "tutar", label: "Tutar (TL)", type: "money", total: true, get: (r) => r.amount_try },
    { key: "durum", label: "Durum", type: "text", width: 20, get: (r) => label(STATUS.captureStatus, r.status) },
    { key: "deneme", label: "Deneme sayısı", type: "number", get: (r) => r.attempt_count },
    { key: "hata", label: "Son hata kodu", type: "text", width: 20, get: (r) => r.last_error_code },
    { key: "yakalama", label: "Yakalama", type: "datetime", get: (r) => r.captured_at },
    { key: "tamam", label: "Tamamlanma", type: "datetime", get: (r) => r.fulfilled_at },
    { key: "iade", label: "İade", type: "datetime", get: (r) => r.refunded_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase.from("billing_payment_captures").select("id, tenant_id, target_type, amount_try, status, attempt_count, last_error_code, captured_at, fulfilled_at, refunded_at", { count: "exact" });
      if (f.durum) q = q.eq("status", f.durum);
      q = applyTimestampRange(q, "captured_at", f);
      return q.order("captured_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichTenants((r) => [r.tenant_id]),
  },
});

export const tahsilatDonemsel = defineReport({
  id: "tahsilat-donemsel",
  title: "Dönemsel tahsilat ve ARPA",
  description: "Ay bazında ödenen fatura sayısı, tahsilat, KDV, ödeme yapan ofis sayısı ve ofis başı ortalama tahsilat (ARPA).",
  category: "gelir",
  scope: "platform",
  platformModule: "billing",
  keywords: ["arpa", "mrr", "gelir", "aylık"],
  filters: [{ kind: "select", key: "ay", label: "Dönem", options: [{ value: "6", label: "Son 6 ay" }, { value: "12", label: "Son 12 ay" }, { value: "24", label: "Son 24 ay" }] }],
  columns: [
    { key: "ay", label: "Ay", type: "text", width: 12, get: (r) => r.label },
    { key: "adet", label: "Ödenen fatura", type: "number", total: true, get: (r) => r.invoices },
    { key: "ofis", label: "Ödeme yapan ofis", type: "number", get: (r) => r.offices },
    { key: "tahsilat", label: "Tahsilat (KDV dahil)", type: "money", total: true, get: (r) => r.total },
    { key: "kdv", label: "KDV", type: "money", total: true, get: (r) => r.tax },
    { key: "net", label: "Tahsilat (KDV hariç)", type: "money", total: true, get: (r) => r.net },
    { key: "arpa", label: "ARPA (KDV hariç / ofis)", type: "money", get: (r) => (r.offices > 0 ? r.net / r.offices : null) },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      const months = [6, 12, 24].includes(Number(f.ay)) ? Number(f.ay) : 12;
      const keys: string[] = [];
      for (let i = months - 1; i >= 0; i -= 1) keys.push(trMonthKey(now(), -i));
      const startIso = `${keys[0]}-01T00:00:00+03:00`;
      const res = await fetchAllRows<Row>((from, to) =>
        ctx.supabase.from("invoices").select("id, tenant_id, amount_try, tax_try, total_try, paid_at").eq("status", "paid").gte("paid_at", startIso).order("id", { ascending: true }).range(from, to),
      );
      if (res.error) throw new Error("tahsilat okuma hatası");
      const by = new Map(keys.map((k) => [k, { key: k, invoices: 0, total: 0, tax: 0, net: 0, tenants: new Set<string>() }]));
      for (const inv of res.data) {
        const key = trMonthKey(inv.paid_at);
        const m = by.get(key);
        if (!m) continue;
        m.invoices += 1;
        m.total += Number(inv.total_try) || 0;
        m.tax += Number(inv.tax_try) || 0;
        m.net += Number(inv.amount_try) || 0;
        m.tenants.add(inv.tenant_id);
      }
      return [...by.values()].map((m) => ({ ...m, offices: m.tenants.size, label: `${m.key.slice(5, 7)}.${m.key.slice(0, 4)}` })).reverse();
    },
  },
});

export const paketDagilimi = defineReport({
  id: "paket-dagilimi",
  title: "Paket dağılımı ve MRR (anlık)",
  description: "Aktif aboneliklerin paket ve faturalama dönemine göre ofis sayısı, toplam tutar ve aylık eşdeğer geliri (MRR; yıllık tutar / 12).",
  category: "gelir",
  scope: "platform",
  platformModule: "billing",
  keywords: ["mrr", "paket", "dağılım", "plan"],
  filters: [],
  columns: [
    { key: "paket", label: "Paket", type: "text", width: 18, get: (r) => planLabel(r.plan) },
    { key: "donem", label: "Faturalama", type: "text", width: 12, get: (r) => label(STATUS.billingCycle, r.cycle) },
    { key: "ofis", label: "Aktif ofis", type: "number", total: true, get: (r) => r.offices },
    { key: "koltuk", label: "Ek koltuk", type: "number", total: true, get: (r) => r.seats },
    { key: "tutar", label: "Toplam tutar (TL)", type: "money", total: true, get: (r) => r.amount },
    { key: "mrr", label: "Aylık eşdeğer – MRR (TL)", type: "money", total: true, get: (r) => r.mrr },
  ],
  source: {
    kind: "compute",
    run: async (ctx) => {
      const res = await fetchAllRows<Row>((from, to) =>
        ctx.supabase.from("subscriptions").select("id, plan, billing_cycle, amount_try, extra_seats").eq("status", "active").order("id", { ascending: true }).range(from, to),
      );
      if (res.error) throw new Error("abonelik okuma hatası");
      const by = new Map<string, { plan: string; cycle: string; offices: number; seats: number; amount: number; mrr: number }>();
      for (const s of res.data) {
        const key = `${s.plan}|${s.billing_cycle}`;
        const cur = by.get(key) ?? { plan: s.plan, cycle: s.billing_cycle, offices: 0, seats: 0, amount: 0, mrr: 0 };
        const amount = Number(s.amount_try) || 0;
        cur.offices += 1;
        cur.seats += Number(s.extra_seats) || 0;
        cur.amount += amount;
        cur.mrr += s.billing_cycle === "yearly" ? amount / 12 : amount;
        by.set(key, cur);
      }
      return [...by.values()].sort((a, b) => b.mrr - a.mrr);
    },
  },
});

export const kuponlar = defineReport({
  id: "kuponlar",
  title: "Kuponlar",
  description: "İndirim kuponları: kod, tür, değer, kullanım limiti, kullanılan adet, geçerlilik ve geçerli paketler.",
  category: "gelir",
  scope: "platform",
  platformModule: "billing",
  keywords: ["indirim", "kampanya kodu"],
  filters: [{ kind: "select", key: "tur", label: "Tür", options: opts(STATUS.couponKind) }, { kind: "select", key: "aktif", label: "Durum", options: [{ value: "evet", label: "Aktif" }, { value: "hayir", label: "Pasif" }] }, ...DATE_RANGE_FIELDS("Oluşturma başlangıcı", "Oluşturma bitişi")],
  columns: [
    { key: "kod", label: "Kod", type: "text", width: 18, get: (r) => r.code },
    { key: "aciklama", label: "Açıklama", type: "text", width: 30, get: (r) => r.description },
    { key: "tur", label: "Tür", type: "text", width: 10, get: (r) => label(STATUS.couponKind, r.kind) },
    { key: "deger", label: "Değer", type: "number", decimals: 2, get: (r) => r.value },
    { key: "limit", label: "Kullanım limiti", type: "number", get: (r) => r.max_redemptions },
    { key: "kullanilan", label: "Kullanılan", type: "number", total: true, get: (r) => r.redeemed_count },
    { key: "bas", label: "Geçerlilik başlangıcı", type: "date", get: (r) => r.valid_from },
    { key: "bit", label: "Geçerlilik bitişi", type: "date", get: (r) => r.valid_until },
    { key: "paketler", label: "Geçerli paketler", type: "text", width: 26, get: (r) => (Array.isArray(r.plan_ids) && r.plan_ids.length ? r.plan_ids.map(planLabel).join(", ") : "Tüm paketler") },
    { key: "aktif", label: "Aktif", type: "bool", get: (r) => r.is_active },
    { key: "kayit", label: "Oluşturma", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase.from("coupons").select("id, code, description, kind, value, max_redemptions, redeemed_count, valid_from, valid_until, plan_ids, is_active, created_at", { count: "exact" });
      if (f.tur) q = q.eq("kind", f.tur);
      if (f.aktif) q = q.eq("is_active", f.aktif === "evet");
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
  },
});

export const kuponKullanimlari = defineReport({
  id: "kupon-kullanimlari",
  title: "Kupon kullanımları",
  description: "Kuponların hangi ofis tarafından, hangi faturada ve ne kadar indirimle kullanıldığı.",
  category: "gelir",
  scope: "platform",
  platformModule: "billing",
  keywords: ["indirim", "kupon", "kullanım"],
  filters: [...DATE_RANGE_FIELDS("Kullanım başlangıcı", "Kullanım bitişi")],
  columns: [
    { key: "tarih", label: "Kullanım tarihi", type: "datetime", get: (r) => r.created_at },
    { key: "kod", label: "Kupon", type: "text", width: 18, get: (r, c) => (c.memo.get("couponCodes") as Map<string, string> | undefined)?.get(r.coupon_id) },
    { key: "ofis", label: "Ofis", type: "text", width: 30, get: (r, c) => nameOf(c, r.tenant_id) },
    { key: "fatura", label: "Fatura no", type: "text", width: 18, get: (r, c) => (c.memo.get("invoiceNos") as Map<string, string> | undefined)?.get(r.invoice_id) },
    { key: "indirim", label: "İndirim (TL)", type: "money", total: true, get: (r) => r.discount_try },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase.from("coupon_redemptions").select("id, coupon_id, tenant_id, invoice_id, discount_try, created_at", { count: "exact" });
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: chainEnrich(enrichTenants((r) => [r.tenant_id]), async (rows, ctx) => {
      const codes = (ctx.memo.get("couponCodes") as Map<string, string> | undefined) ?? new Map<string, string>();
      const inv = (ctx.memo.get("invoiceNos") as Map<string, string> | undefined) ?? new Map<string, string>();
      ctx.memo.set("couponCodes", codes);
      ctx.memo.set("invoiceNos", inv);
      const cids = [...new Set(rows.map((r) => r.coupon_id).filter((v) => v && !codes.has(v)))];
      const iids = [...new Set(rows.map((r) => r.invoice_id).filter((v) => v && !inv.has(v)))];
      if (cids.length) {
        const { data } = await ctx.supabase.from("coupons").select("id, code").in("id", cids);
        for (const c of (data ?? []) as Row[]) codes.set(c.id, c.code);
      }
      if (iids.length) {
        const { data } = await ctx.supabase.from("invoices").select("id, invoice_no").in("id", iids);
        for (const c of (data ?? []) as Row[]) inv.set(c.id, c.invoice_no);
      }
    }),
  },
});

const LEDGER_ENTRY: Record<string, string> = { grant: "Yükleme", spend: "Harcama", commit: "Harcama (kesinleşti)", reserve: "Rezerve", release: "Rezerv serbest", refund: "İade", expire: "Süresi doldu", adjust: "Düzeltme" };

const USAGE_COLUMNS: ReportColumn[] = [
  { key: "birim", label: "Birim", type: "text", width: 12, get: (r) => r.unit },
  { key: "ozellik", label: "Özellik", type: "text", width: 22, get: (r) => r.feature },
  { key: "model", label: "Model", type: "text", width: 18, get: (r) => r.model },
  { key: "girdi", label: "Girdi token", type: "number", total: true, get: (r) => r.tokens_in },
  { key: "cikti", label: "Çıktı token", type: "number", total: true, get: (r) => r.tokens_out },
];

function ledgerReport(opts2: { id: string; title: string; description: string; unit: string | string[]; unitLabel: string; keywords: string[]; usage?: boolean }) {
  const units = Array.isArray(opts2.unit) ? opts2.unit : [opts2.unit];
  return defineReport({
    id: opts2.id,
    title: opts2.title,
    description: opts2.description,
    category: "gelir",
    scope: "platform",
    platformModule: "billing",
    keywords: opts2.keywords,
    filters: [
      { kind: "select", key: "tur", label: "Hareket türü", options: opts(LEDGER_ENTRY) },
      { kind: "text", key: "kaynak", label: "Kaynak", placeholder: "purchase, admin, bonus..." },
      ...DATE_RANGE_FIELDS(),
    ],
    columns: [
      { key: "tarih", label: "Zaman", type: "datetime", get: (r) => r.created_at },
      { key: "ofis", label: "Ofis", type: "text", width: 30, get: (r, c) => nameOf(c, r.tenant_id) },
      { key: "tur", label: "Hareket", type: "text", width: 18, get: (r) => label(LEDGER_ENTRY, r.entry_type) },
      { key: "miktar", label: opts2.unitLabel, type: "number", decimals: 2, total: true, get: (r) => r.amount },
      { key: "kaynak", label: "Kaynak", type: "text", width: 18, get: (r) => r.source },
      ...(opts2.usage ? USAGE_COLUMNS : []),
      { key: "bitis", label: "Geçerlilik bitişi", type: "date", get: (r) => r.expires_at },
      { key: "kullanici", label: "Kullanıcı", type: "text", width: 22, get: (r, c) => nameOf(c, r.created_by) },
    ],
    source: {
      kind: "query",
      build: (ctx, f) => {
        let q = ctx.supabase
          .from("account_credit_ledger")
          .select("id, tenant_id, unit, entry_type, amount, source, feature, model, tokens_in, tokens_out, expires_at, created_by, created_at", { count: "exact" })
          .in("unit", units);
        if (f.tur) q = q.eq("entry_type", f.tur);
        if (f.kaynak) q = searchOr(q, ["source"], f.kaynak);
        q = applyTimestampRange(q, "created_at", f);
        return q.order("created_at", { ascending: false }).order("id", { ascending: true });
      },
      enrich: chainEnrich(enrichTenants((r) => [r.tenant_id]), async (rows, ctx) => {
        const ids = [...new Set(rows.map((r) => r.created_by).filter((v) => v && !ctx.names.has(v)))];
        if (!ids.length) return;
        const { data } = await ctx.supabase.from("profiles").select("id, full_name").in("id", ids);
        for (const p of (data ?? []) as Row[]) ctx.names.set(p.id, p.full_name);
      }),
    },
  });
}

export const hesapKredisi = ledgerReport({
  id: "hesap-kredisi",
  title: "Hesap kredisi hareketleri (TL)",
  description: "Ofislerin TL hesap kredisi defteri: yükleme, harcama, iade ve süre sonu hareketleri.",
  unit: "try",
  unitLabel: "Tutar (TL)",
  keywords: ["kredi", "cüzdan", "bakiye", "referans ödülü"],
});

export const efKontor = ledgerReport({
  id: "ef-kontor",
  title: "EmlakFiyati kontör hareketleri",
  description: "Değerleme / parsel raporu kontör defteri: plan kontörü, satın alma, bonus, harcama, iade ve süresi dolup yanan kontör.",
  unit: "ef",
  unitLabel: "Kontör",
  keywords: ["kontör", "emlakfiyati", "değerleme", "parsel"],
});

export const aiKullanimi = ledgerReport({
  id: "ai-kullanimi",
  title: "AI ve değerleme kullanımı",
  description: "Yapay zekâ asistanı ve değerleme harcamaları: özellik, model, token kullanımı ve ofis bazında dağılım.",
  unit: ["ai", "valuation"],
  unitLabel: "Harcanan kredi",
  keywords: ["yapay zeka", "openai", "token", "asistan"],
  usage: true,
});

const TICKET_CATEGORY: Record<string, string> = defaultLabelMap("ticket_category");

export const destekTalepleri = defineReport({
  id: "destek-talepleri",
  title: "Destek talepleri",
  description: "Destek talepleri: ofis, konu, kategori, öncelik, durum, ilk yanıt ve çözüm süreleri, SLA ihlalleri.",
  category: "destek",
  scope: "platform",
  platformModule: "tickets",
  keywords: ["ticket", "sla", "çözüm süresi", "yanıt"],
  filters: [
    { kind: "select", key: "durum", label: "Durum", options: [{ value: "acik", label: "Açık (çözülmemiş)" }, { value: "cozulmus", label: "Çözülmüş / kapalı" }, ...opts(STATUS.ticket)] },
    { kind: "select", key: "oncelik", label: "Öncelik", options: opts(STATUS.ticketPriority) },
    { kind: "select", key: "kategori", label: "Kategori", options: opts(TICKET_CATEGORY) },
    ...DATE_RANGE_FIELDS("Açılış başlangıcı", "Açılış bitişi"),
  ],
  columns: [
    { key: "no", label: "Talep no", type: "text", width: 14, get: (r) => r.ticket_no },
    { key: "konu", label: "Konu", type: "text", width: 36, get: (r) => r.subject },
    { key: "ofis", label: "Ofis", type: "text", width: 28, get: (r, c) => nameOf(c, r.tenant_id) },
    { key: "kategori", label: "Kategori", type: "text", width: 18, get: (r) => label(TICKET_CATEGORY, r.category) },
    { key: "oncelik", label: "Öncelik", type: "text", width: 10, get: (r) => label(STATUS.ticketPriority, r.priority) },
    { key: "durum", label: "Durum", type: "text", width: 14, get: (r) => label(STATUS.ticket, r.status) },
    { key: "atanan", label: "Atanan personel", type: "text", width: 22, get: (r, c) => nameOf(c, r.assigned_staff_id ?? r.assigned_to) },
    { key: "acilis", label: "Açılış", type: "datetime", get: (r) => r.created_at },
    { key: "yanit", label: "İlk yanıt", type: "datetime", get: (r) => r.first_response_at },
    { key: "yanitIhlal", label: "İlk yanıt SLA ihlali", type: "bool", get: (r) => !!r.first_response_breached_at },
    { key: "cozum", label: "Çözüm", type: "datetime", get: (r) => r.resolved_at },
    { key: "cozumIhlal", label: "Çözüm SLA ihlali", type: "bool", get: (r) => !!r.resolution_breached_at },
    { key: "yenidenAcilma", label: "Yeniden açılma", type: "number", get: (r) => r.reopen_count },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("support_tickets")
        .select("id, tenant_id, ticket_no, subject, category, priority, status, assigned_to, assigned_staff_id, created_at, first_response_at, first_response_breached_at, resolved_at, resolution_breached_at, reopen_count", { count: "exact" });
      if (f.durum === "acik") q = q.in("status", ["open", "in_progress", "waiting"]);
      else if (f.durum === "cozulmus") q = q.in("status", ["resolved", "closed"]);
      else if (f.durum) q = q.eq("status", f.durum);
      if (f.oncelik) q = q.eq("priority", f.oncelik);
      if (f.kategori) q = q.eq("category", f.kategori);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: chainEnrich(enrichTenants((r) => [r.tenant_id]), enrichStaff((r) => [r.assigned_staff_id, r.assigned_to])),
  },
});

export const platformDenetim = defineReport({
  id: "platform-denetim",
  title: "Platform denetim kaydı (personel işlemleri)",
  description: "EmlakSoft personelinin yaptığı yönetim işlemleri: kim, ne zaman, hangi kayıt ve ayrıntı.",
  category: "platform",
  scope: "platform",
  platformModule: "activity",
  personalData: true,
  keywords: ["audit", "log", "personel", "yönetici işlemi"],
  filters: [{ kind: "text", key: "q", label: "İşlem kodu", placeholder: "ör. tenant.suspend" }, ...DATE_RANGE_FIELDS()],
  columns: [
    { key: "tarih", label: "Zaman", type: "datetime", get: (r) => r.created_at },
    { key: "personel", label: "Personel", type: "text", width: 24, get: (r, c) => nameOf(c, r.actor_id) || "Sistem" },
    { key: "islem", label: "İşlem", type: "text", width: 34, get: (r) => auditActionLabel(r.action) },
    { key: "kod", label: "İşlem kodu", type: "text", width: 26, get: (r) => r.action },
    { key: "varlik", label: "Varlık türü", type: "text", width: 16, get: (r) => r.entity_type },
    { key: "varlikId", label: "Varlık kimliği", type: "text", width: 36, get: (r) => r.entity_id },
    { key: "ayrinti", label: "Ayrıntı", type: "text", width: 44, get: (r) => (r.meta == null ? "" : JSON.stringify(r.meta).slice(0, 600)) },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase.from("platform_audit_logs").select("id, actor_id, action, entity_type, entity_id, meta, created_at", { count: "exact" });
      q = searchOr(q, ["action"], f.q);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichStaff((r) => [r.actor_id]),
  },
});

export const ofisDenetim = defineReport({
  id: "ofis-denetim-kayitlari",
  title: "Ofis denetim kayıtları (tüm ofisler)",
  description: "Ofis kullanıcılarının uygulamadaki işlemleri (denetim günlüğü): ofis, işlem, kayıt türü ve zaman.",
  category: "platform",
  scope: "platform",
  platformModule: "activity",
  keywords: ["audit", "ofis işlemi", "kvkk"],
  filters: [{ kind: "text", key: "q", label: "İşlem kodu", placeholder: "ör. customer.delete" }, ...DATE_RANGE_FIELDS()],
  columns: [
    { key: "tarih", label: "Zaman", type: "datetime", get: (r) => r.created_at },
    { key: "ofis", label: "Ofis", type: "text", width: 28, get: (r, c) => nameOf(c, r.tenant_id) },
    { key: "islem", label: "İşlem", type: "text", width: 34, get: (r) => auditActionLabel(r.action) },
    { key: "kod", label: "İşlem kodu", type: "text", width: 26, get: (r) => r.action },
    { key: "varlik", label: "Kayıt türü", type: "text", width: 16, get: (r) => r.entity_type },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase.from("audit_logs").select("id, tenant_id, action, entity_type, created_at", { count: "exact" });
      q = searchOr(q, ["action"], f.q);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichTenants((r) => [r.tenant_id]),
  },
});

export const kayitKaynaklari = defineReport({
  id: "kayit-kaynaklari",
  title: "Büyüme ve kayıt kaynakları",
  description: "Yeni ofislerin nereden geldiği: tavsiye, ortak, araç, marka bağlantısı, UTM bilgileri ve giriş sayfası.",
  category: "satis",
  scope: "platform",
  platformModule: "sales",
  keywords: ["atıf", "utm", "referans", "büyüme"],
  filters: [{ kind: "select", key: "tur", label: "Kaynak türü", options: opts(STATUS.leadRef) }, { kind: "text", key: "q", label: "UTM kaynağı", placeholder: "google, instagram..." }, ...DATE_RANGE_FIELDS("Kayıt başlangıcı", "Kayıt bitişi")],
  columns: [
    { key: "ofis", label: "Ofis", type: "text", width: 30, get: (r, c) => nameOf(c, r.tenant_id) },
    { key: "tur", label: "Kaynak türü", type: "text", width: 16, get: (r) => label(STATUS.leadRef, r.ref_kind) },
    { key: "yonlendiren", label: "Yönlendiren ofis", type: "text", width: 28, get: (r, c) => nameOf(c, r.referrer_tenant_id) },
    { key: "utms", label: "UTM kaynak", type: "text", width: 16, get: (r) => r.utm_source },
    { key: "utmm", label: "UTM ortam", type: "text", width: 16, get: (r) => r.utm_medium },
    { key: "utmc", label: "UTM kampanya", type: "text", width: 20, get: (r) => r.utm_campaign },
    { key: "sayfa", label: "Giriş sayfası", type: "text", width: 30, get: (r) => r.landing_path },
    { key: "ilk", label: "İlk ziyaret", type: "datetime", get: (r) => r.first_seen_at },
    { key: "kayit", label: "Kayıt", type: "datetime", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("signup_attributions")
        .select("tenant_id, ref_kind, referrer_tenant_id, utm_source, utm_medium, utm_campaign, landing_path, first_seen_at, created_at", { count: "exact" });
      if (f.tur) q = q.eq("ref_kind", f.tur);
      q = searchOr(q, ["utm_source"], f.q);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("tenant_id", { ascending: true });
    },
    enrich: enrichTenants((r) => [r.tenant_id, r.referrer_tenant_id]),
  },
});

export const demoTalepleri = defineReport({
  id: "demo-talepleri",
  title: "Demo ve satış talepleri",
  description: "Web formundan gelen demo / görüşme talepleri: iletişim, firma, ekip büyüklüğü, durum ve dönüşen ofis.",
  category: "satis",
  scope: "platform",
  platformModule: "sales",
  personalData: true,
  keywords: ["demo", "lead", "aday", "satış"],
  filters: [{ kind: "select", key: "durum", label: "Durum", options: opts(STATUS.demoRequest) }, { kind: "text", key: "q", label: "Ad / firma", placeholder: "Ara" }, ...DATE_RANGE_FIELDS()],
  columns: [
    { key: "ad", label: "Ad soyad", type: "text", width: 24, get: (r) => r.full_name },
    { key: "telefon", label: "Telefon", type: "text", width: 16, get: (r) => formatPhoneDisplay(r.phone) },
    { key: "eposta", label: "E-posta", type: "text", width: 28, get: (r) => r.email },
    { key: "firma", label: "Firma", type: "text", width: 24, get: (r) => r.company },
    { key: "sehir", label: "Şehir", type: "text", width: 14, get: (r) => r.city },
    { key: "ekip", label: "Ekip büyüklüğü", type: "text", width: 14, get: (r) => r.team_size },
    { key: "durum", label: "Durum", type: "text", width: 14, get: (r) => label(STATUS.demoRequest, r.status) },
    { key: "kaynak", label: "Kaynak", type: "text", width: 14, get: (r) => r.source },
    { key: "atanan", label: "Atanan", type: "text", width: 20, get: (r, c) => nameOf(c, r.assigned_to) },
    { key: "donusen", label: "Dönüşen ofis", type: "text", width: 26, get: (r, c) => nameOf(c, r.converted_tenant_id) },
    { key: "tarih", label: "Talep tarihi", type: "datetime", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("demo_requests")
        .select("id, full_name, phone, email, company, city, team_size, status, source, assigned_to, converted_tenant_id, created_at", { count: "exact" });
      if (f.durum) q = q.eq("status", f.durum);
      q = searchOr(q, ["full_name", "company"], f.q);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: chainEnrich(enrichStaff((r) => [r.assigned_to]), enrichTenants((r) => [r.converted_tenant_id])),
  },
});

export const PLATFORM_REPORTS = [ofisler, uyeler, abonelikler, faturalar, odemeUyarilari, tahsilatDonemsel, paketDagilimi, kuponlar, kuponKullanimlari, hesapKredisi, efKontor, aiKullanimi, destekTalepleri, platformDenetim, ofisDenetim, kayitKaynaklari, demoTalepleri];
