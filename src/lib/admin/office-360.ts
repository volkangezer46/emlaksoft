import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlan } from "@/lib/billing/plans";
import { daysAgoIso } from "@/lib/clock";
import { auditActionLabel } from "@/lib/admin-format";
import { platformCanAccess, type PlatformRole } from "@/lib/platform-access";
import type { TimelineEvent } from "@/lib/activity-timeline";

/**
 * Ofis 360 (süper admin ofis detayı) veri katmanı.
 * Hiçbir yerde createAdminClient çağrılmaz: yetkili client sayfadan parametre olarak gelir.
 * Gizlilik: yalnız sayılar, olay adları ve ofis personeli adları; ofisin müşteri kişisel verisi
 * (ad, telefon, e-posta, not) bu katmanda HİÇ okunmaz. IP yalnız süper adminde gösterilir.
 */

export const OFFICE_TABS = ["zaman", "yonetim", "abonelik", "destek", "kullanim", "ekip", "yasal", "fatura"] as const;
export type OfficeTab = (typeof OFFICE_TABS)[number];

export const TIMELINE_CATEGORIES: { key: string; label: string }[] = [
  { key: "degerleme", label: "Değerleme" },
  { key: "odeme", label: "Ödeme" },
  { key: "iade", label: "İade" },
  { key: "destek", label: "Destek" },
  { key: "abonelik", label: "Abonelik" },
  { key: "onay", label: "Onay" },
  { key: "oturum", label: "Oturum" },
  { key: "hesap", label: "Hesap" },
  { key: "personel", label: "Personel" },
];

export type OfficeAccess = {
  billing: boolean;
  tickets: boolean;
  activity: boolean;
  members: boolean;
  /** IP adresi yalnız süper admin (KVKK). */
  showIp: boolean;
};

export function officeAccess(role: PlatformRole): OfficeAccess {
  return {
    billing: platformCanAccess(role, "billing"),
    tickets: platformCanAccess(role, "tickets"),
    activity: platformCanAccess(role, "activity"),
    members: platformCanAccess(role, "members"),
    showIp: role === "super_admin",
  };
}

/** Role göre görünen sekmeler (veri kaynağı olmayan/yetkisiz sekme gösterilmez). */
export function visibleTabs(access: OfficeAccess): OfficeTab[] {
  return OFFICE_TABS.filter((t) => {
    if (t === "abonelik" || t === "fatura") return access.billing;
    if (t === "destek") return access.tickets;
    if (t === "ekip") return access.members;
    return true;
  });
}

export function resolveOfficeTab(raw: string | string[] | undefined, allowed: readonly OfficeTab[]): OfficeTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (allowed as readonly string[]).includes(v ?? "") ? (v as OfficeTab) : "zaman";
}

/** Plan limiti karşısında kullanım satırı. limit null = sınırsız. */
export type LimitRow = { key: string; label: string; used: number; limit: number | null; href?: string };

export function limitPercent(row: Pick<LimitRow, "used" | "limit">): number | null {
  if (row.limit == null || row.limit <= 0) return null;
  return Math.min(100, Math.round((row.used / row.limit) * 100));
}

export function limitText(row: Pick<LimitRow, "used" | "limit">): string {
  const nf = new Intl.NumberFormat("tr-TR");
  return `${nf.format(row.used)} / ${row.limit == null ? "sınırsız" : nf.format(row.limit)}`;
}

export function buildLimitRows(
  plan: string | null | undefined,
  used: { seats: number; properties: number; customers: number; branches: number },
  seatsHref?: string,
): LimitRow[] {
  const l = getPlan(plan ?? "office").limits;
  return [
    { key: "seats", label: "Kullanıcı", used: used.seats, limit: l.seats, href: seatsHref },
    { key: "properties", label: "Aktif ilan", used: used.properties, limit: l.activeProperties },
    { key: "customers", label: "Müşteri", used: used.customers, limit: l.customers },
    { key: "branches", label: "Şube", used: used.branches, limit: l.branches },
  ];
}

// ---------------------------------------------------------------------------
// Olay etiketleri
// ---------------------------------------------------------------------------

const ACCOUNT_ACTION_TITLES: Record<string, string> = {
  "ops.impersonate.start": "Personel müşteri görünümünü açtı (salt okunur)",
  "ops.impersonate.stop": "Personel müşteri görünümünden çıktı",
  "tenant.create": "Ofis oluşturuldu",
  "tenant.update": "Ofis bilgileri güncellendi",
  "tenant.slug_change": "Vitrin adresi değiştirildi",
  "tenant.trial_extend": "Deneme süresi uzatıldı",
  "tenant.suspend": "Ofis askıya alındı",
  "tenant.reactivate": "Ofis yeniden etkinleştirildi",
  "tenant.archive": "Ofis arşivlendi",
  "tenant.restore": "Ofis arşivden geri yüklendi",
  "tenant.owner_access_link": "Sahibe erişim bağlantısı gönderildi",
  "tenant.owner_email_change": "Sahip e-postası değiştirildi",
  "tenant.owner_transfer": "Sahiplik devredildi",
  "tenant.user_add": "Ofise kullanıcı eklendi",
  "tenant.user_deactivate": "Ofis kullanıcısı pasife alındı",
  "tenant.user_reactivate": "Ofis kullanıcısı yeniden etkinleştirildi",
  "tenant.note": "Dahili not eklendi",
  "billing.tenant_plan_status": "Paket veya durum değiştirildi",
  "team.member_created": "Kullanıcı hesabı oluşturuldu (platform)",
  "team.member_deactivated": "Kullanıcı pasife alındı (platform)",
  "team.member_reactivated": "Kullanıcı yeniden etkinleştirildi (platform)",
  "team.owner_transfer": "Ofis sahipliği devredildi (platform)",
  "team.owner_email_change": "Sahip e-postası değiştirildi (platform)",
  "subscription.update": "Abonelik güncellendi",
  "settings.update": "Ofis ayarları güncellendi",
  "settings.watermark_update": "Filigran ayarı güncellendi",
  "settings.matching_weights": "Eşleştirme ağırlıkları güncellendi",
  "team.advisor_created": "Danışman hesabı oluşturuldu",
  "team.handoff": "Personel devri yapıldı",
  "team.handoff.failed": "Personel devri başarısız oldu",
  "kvkk.erasure": "KVKK silme/anonimleştirme uygulandı",
  "kvkk.purge": "KVKK kalıcı temizlik uygulandı",
  "iys.upsert": "İYS izni güncellendi",
  "export.csv": "Veri dışa aktarıldı (CSV)",
  "export.csv.full": "Tam veri dışa aktarıldı (CSV)",
  "export.report": "Rapor indirildi (Rapor merkezi)",
  "sample_data.seed": "Örnek veri yüklendi",
  "sample_data.clear": "Örnek veri temizlendi",
  "valuation.create": "Değerleme oluşturuldu",
  "valuation.share": "Değerleme paylaşıldı",
  "lead.capture.toggle": "Başvuru formu açıldı/kapatıldı",
  "lead.capture.regenerate_token": "Başvuru formu bağlantısı yenilendi",
  "booking.settings.update": "Randevu sayfası ayarı güncellendi",
  "booking.token.regenerate": "Randevu bağlantısı yenilendi",
  "agent_profile.update": "Danışman vitrin profili güncellendi",
};

/** audit_logs içinde Ofis 360'a alınan hesap düzeyi öneklerin PostgREST `or` süzgeci. */
export const ACCOUNT_AUDIT_OR = [
  "ops.%",
  "tenant.%",
  "subscription.%",
  "settings.%",
  "team.%",
  "integration.%",
  "kvkk.%",
  "iys.%",
  "export.%",
  "import.%",
  "sample_data.%",
  "lead.capture.%",
  "booking.%",
  "agent_profile.%",
  "valuation.%",
]
  .map((p) => `action.like.${p.replace(/%/g, "*")}`)
  .join(",");

export function auditCategory(action: string): string {
  if (action.startsWith("valuation.")) return "degerleme";
  if (action.startsWith("subscription.")) return "abonelik";
  if (action.startsWith("kvkk.") || action.startsWith("iys.")) return "onay";
  if (action.startsWith("team.") || action.startsWith("platform_staff.")) return "personel";
  return "hesap";
}

export function auditTitle(action: string): string {
  return ACCOUNT_ACTION_TITLES[action] ?? auditActionLabel(action);
}

const nfTl = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
export function tl(n: number | string | null | undefined): string {
  return `${nfTl.format(Number(n ?? 0))} ₺`;
}

// ---------------------------------------------------------------------------
// Ham satır tipleri
// ---------------------------------------------------------------------------

export type AuditRow = { id: string; action: string; actor_id: string | null; ip: string | null; created_at: string };
export type PlatformAuditRow = { id: string; action: string; actor_id: string | null; created_at: string };
export type InvoiceRow = {
  id: string;
  invoice_no: string;
  status: string;
  total_try: number | string;
  due_at: string | null;
  paid_at: string | null;
  created_at: string;
};
export type CaptureRow = {
  id: string;
  status: string;
  amount_try: number | string;
  captured_at: string;
  fulfilled_at: string | null;
  refunded_at: string | null;
};
export type TicketRow = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
  resolved_at: string | null;
};
export type LoginRow = { id: string; user_id: string | null; ip: string | null; result: string; created_at: string };
export type ConsentRow = {
  id: string;
  user_id: string;
  terms_version: string;
  kvkk_version: string;
  accepted_at: string;
  ip_address: string | null;
};
export type IysEventRow = {
  id: string;
  channel: string;
  from_status: string | null;
  to_status: string;
  source: string;
  occurred_at: string;
};
export type ErasureRow = { id: string; performed_at: string };
export type SubRow = {
  status: string;
  plan: string;
  created_at: string;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
};
export type ProfileRow = { id: string; created_at: string };

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Taslak",
  open: "Açık",
  paid: "Ödendi",
  void: "İptal",
  uncollectible: "Tahsil edilemedi",
};
export const CAPTURE_STATUS_LABEL: Record<string, string> = {
  captured_pending: "İşleniyor",
  retry_pending: "Yeniden denenecek",
  manual_review: "Elle inceleme",
  refund_required: "İade gerekli",
  refunded: "İade edildi",
  fulfilled: "Tamamlandı",
};
const CHANNEL_LABEL: Record<string, string> = { sms: "SMS", email: "E-posta", whatsapp: "WhatsApp", call: "Arama" };
const IYS_STATUS_LABEL: Record<string, string> = {
  granted: "verildi",
  denied: "reddedildi",
  unknown: "bilinmiyor",
  pending: "beklemede",
  revoked: "geri alındı",
};
export const TICKET_STATUS_LABEL: Record<string, string> = {
  open: "Açık",
  in_progress: "İşleniyor",
  waiting: "Yanıt bekliyor",
  resolved: "Çözüldü",
  closed: "Kapalı",
};
export const LOGIN_RESULT_LABEL: Record<string, string> = {
  success: "Başarılı giriş",
  failed: "Başarısız giriş denemesi",
  "2fa_pending": "2FA doğrulaması bekledi",
  "2fa_failed": "2FA doğrulaması başarısız",
};

export type TimelineInput = {
  tenantId: string;
  tenantCreatedAt: string | null;
  tenantName: string;
  access: OfficeAccess;
  actorNames: Map<string, string>;
  audit: AuditRow[];
  platformAudit: PlatformAuditRow[];
  sub: SubRow | null;
  invoices: InvoiceRow[];
  captures: CaptureRow[];
  tickets: TicketRow[];
  logins: LoginRow[];
  consents: ConsentRow[];
  iys: IysEventRow[];
  erasures: ErasureRow[];
  profiles: ProfileRow[];
};

/** Tüm kaynakları tek TimelineEvent akışına birleştirir (saf; testlenir). */
export function buildOfficeTimeline(i: TimelineInput): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  const who = (id: string | null | undefined) => (id ? i.actorNames.get(id) : undefined);
  const ip = (v: string | null | undefined) => (i.access.showIp && v ? v : undefined);
  const base = `/admin/tenants/${i.tenantId}`;

  if (i.tenantCreatedAt) {
    ev.push({ id: "tenant-created", at: i.tenantCreatedAt, category: "hesap", title: "Ofis hesabı oluşturuldu", icon: "history" });
  }
  for (const a of i.audit) {
    const start = a.action === "ops.impersonate.start";
    const stop = a.action === "ops.impersonate.stop";
    ev.push({
      id: `audit-${a.id}`,
      at: a.created_at,
      category: auditCategory(a.action),
      title: auditTitle(a.action),
      actor: who(a.actor_id),
      ip: ip(a.ip),
      icon: start || stop ? "view" : undefined,
      tone: start ? "warn" : a.action === "team.handoff.failed" ? "danger" : undefined,
    });
  }
  for (const p of i.platformAudit) {
    // audit_logs'ta zaten olan impersonation olayları platform tarafında tekrar yazılmaz; yine de çift göstermeyiz.
    if (p.action.startsWith("ops.impersonate.")) continue;
    ev.push({
      id: `plat-${p.id}`,
      at: p.created_at,
      category: p.action.startsWith("subscription.") ? "abonelik" : "hesap",
      title: `Platform: ${auditTitle(p.action)}`,
      actor: who(p.actor_id),
      icon: "shield",
    });
  }
  if (i.access.billing && i.sub) {
    const s = i.sub;
    ev.push({ id: "sub-created", at: s.created_at, category: "abonelik", title: `Abonelik kaydı oluştu (${getPlan(s.plan).name})`, icon: "spark" });
    if (s.current_period_start && s.status === "active") {
      ev.push({ id: "sub-period", at: s.current_period_start, category: "abonelik", title: "Abonelik dönemi başladı", icon: "spark", tone: "success" });
    }
    if (s.cancelled_at) {
      ev.push({ id: "sub-cancel", at: s.cancelled_at, category: "abonelik", title: "Abonelik iptal edildi", icon: "spark", tone: "danger" });
    }
  }
  if (i.access.billing) {
    for (const inv of i.invoices) {
      ev.push({
        id: `inv-${inv.id}`,
        at: inv.created_at,
        category: "odeme",
        title: `Fatura düzenlendi · ${inv.invoice_no}`,
        detail: `${tl(inv.total_try)} · ${INVOICE_STATUS_LABEL[inv.status] ?? inv.status}`,
        href: `${base}?sekme=abonelik`,
      });
      if (inv.paid_at) {
        ev.push({
          id: `inv-paid-${inv.id}`,
          at: inv.paid_at,
          category: "odeme",
          title: `Ödeme alındı · ${inv.invoice_no}`,
          detail: tl(inv.total_try),
          tone: "success",
          href: `${base}?sekme=abonelik`,
        });
      }
    }
    for (const c of i.captures) {
      if (c.status === "refunded" || c.refunded_at) {
        ev.push({
          id: `cap-ref-${c.id}`,
          at: c.refunded_at ?? c.captured_at,
          category: "iade",
          title: "Ödeme iade edildi",
          detail: tl(c.amount_try),
          tone: "warn",
          icon: "money",
          href: `${base}?sekme=abonelik`,
        });
      } else if (c.status === "refund_required" || c.status === "manual_review") {
        ev.push({
          id: `cap-${c.id}`,
          at: c.captured_at,
          category: c.status === "refund_required" ? "iade" : "odeme",
          title: c.status === "refund_required" ? "İade gerekiyor (ödeme eşleşmedi)" : "Ödeme elle inceleme bekliyor",
          detail: tl(c.amount_try),
          tone: "danger",
          href: `${base}?sekme=abonelik`,
        });
      }
    }
  }
  if (i.access.tickets) {
    for (const t of i.tickets) {
      ev.push({
        id: `tk-${t.id}`,
        at: t.created_at,
        category: "destek",
        title: `Destek talebi açıldı: ${t.subject}`,
        detail: TICKET_STATUS_LABEL[t.status] ?? t.status,
        href: `/admin/tickets/${t.id}`,
      });
      if (t.resolved_at) {
        ev.push({
          id: `tk-res-${t.id}`,
          at: t.resolved_at,
          category: "destek",
          title: `Destek talebi çözüldü: ${t.subject}`,
          tone: "success",
          href: `/admin/tickets/${t.id}`,
        });
      }
    }
  }
  if (i.access.activity) {
    for (const l of i.logins) {
      ev.push({
        id: `login-${l.id}`,
        at: l.created_at,
        category: "oturum",
        title: LOGIN_RESULT_LABEL[l.result] ?? l.result,
        actor: who(l.user_id),
        ip: ip(l.ip),
        tone: l.result === "success" ? "success" : "danger",
        icon: "key",
      });
    }
  }
  for (const c of i.consents) {
    ev.push({
      id: `cons-${c.id}`,
      at: c.accepted_at,
      category: "onay",
      title: "Kullanım koşulları ve KVKK metni kabul edildi",
      detail: `Koşullar ${c.terms_version} · KVKK ${c.kvkk_version}`,
      actor: who(c.user_id),
      ip: ip(c.ip_address),
      tone: "success",
      href: `${base}?sekme=yasal`,
    });
  }
  for (const e of i.iys) {
    ev.push({
      id: `iys-${e.id}`,
      at: e.occurred_at,
      category: "onay",
      title: `İYS izni değişti · ${CHANNEL_LABEL[e.channel] ?? e.channel}`,
      detail: `${e.from_status ? (IYS_STATUS_LABEL[e.from_status] ?? e.from_status) : "yeni"} → ${IYS_STATUS_LABEL[e.to_status] ?? e.to_status}`,
      href: `${base}?sekme=yasal`,
    });
  }
  for (const e of i.erasures) {
    ev.push({ id: `kv-${e.id}`, at: e.performed_at, category: "onay", title: "KVKK silme talebi uygulandı", tone: "warn", href: `${base}?sekme=yasal` });
  }
  for (const p of i.profiles) {
    ev.push({
      id: `prof-${p.id}`,
      at: p.created_at,
      category: "personel",
      title: `Kullanıcı hesabı eklendi · ${i.actorNames.get(p.id) ?? "kullanıcı"}`,
      icon: "user",
      href: i.access.members ? `/admin/members/${p.id}` : undefined,
    });
  }
  return ev;
}

/** Aboneliğin bitiş tarihi: dönem sonu; yoksa deneme sonu. */
export function subscriptionEnd(sub: Pick<SubRow, "current_period_end" | "trial_ends_at" | "status"> | null): string | null {
  if (!sub) return null;
  if (sub.status === "trialing") return sub.trial_ends_at ?? sub.current_period_end;
  return sub.current_period_end ?? sub.trial_ends_at;
}

// ---------------------------------------------------------------------------
// Yükleyiciler (admin client parametre olarak gelir)
// ---------------------------------------------------------------------------

type Admin = SupabaseClient;

export type OfficeKpiData = {
  seats: number;
  customers: number;
  properties: number;
  branches: number;
  openTickets: number;
  paidTotal: number;
  paidCount: number;
  lastLogin: string | null;
  sub: SubRow | null;
};

export async function loadOfficeKpis(admin: Admin, tenantId: string, access: OfficeAccess): Promise<OfficeKpiData> {
  const head = (table: string) => admin.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const [seats, customers, properties, branches, openTickets, paid, login, sub] = await Promise.all([
    head("profiles").eq("is_active", true),
    head("customers").is("deleted_at", null),
    head("properties").is("deleted_at", null).in("status", ["draft", "live", "reserved"]),
    head("branches"),
    access.tickets ? head("support_tickets").in("status", ["open", "in_progress", "waiting"]) : Promise.resolve({ count: 0 }),
    access.billing
      ? admin.from("invoices").select("total_try").eq("tenant_id", tenantId).eq("status", "paid").limit(5000)
      : Promise.resolve({ data: [] as { total_try: number | string }[] }),
    access.members
      ? admin
          .from("login_events")
          .select("created_at")
          .eq("tenant_id", tenantId)
          .eq("result", "success")
          .order("created_at", { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [] as { created_at: string }[] }),
    admin
      .from("subscriptions")
      .select("status, plan, created_at, trial_ends_at, current_period_start, current_period_end, cancelled_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  const paidRows = (paid.data ?? []) as { total_try: number | string }[];
  return {
    seats: seats.count ?? 0,
    customers: customers.count ?? 0,
    properties: properties.count ?? 0,
    branches: branches.count ?? 0,
    openTickets: openTickets.count ?? 0,
    paidTotal: paidRows.reduce((s, r) => s + Number(r.total_try ?? 0), 0),
    paidCount: paidRows.length,
    lastLogin: (login.data?.[0] as { created_at: string } | undefined)?.created_at ?? null,
    sub: (sub.data as SubRow | null) ?? null,
  };
}

export type TimelineData = TimelineInput;

export async function loadOfficeTimeline(
  admin: Admin,
  tenant: { id: string; name: string; created_at: string | null },
  access: OfficeAccess,
  sub: SubRow | null,
): Promise<TimelineInput> {
  const id = tenant.id;
  const empty = Promise.resolve({ data: [] as never[] });
  const [audit, platformAudit, invoices, captures, tickets, logins, consents, iys, erasures, profiles, staffRows] = await Promise.all([
    access.activity
      ? admin.from("audit_logs").select("id, action, actor_id, ip, created_at").eq("tenant_id", id).or(ACCOUNT_AUDIT_OR).order("created_at", { ascending: false }).limit(150)
      : empty,
    access.activity
      ? admin.from("platform_audit_logs").select("id, action, actor_id, created_at").eq("entity_id", id).order("created_at", { ascending: false }).limit(60)
      : empty,
    access.billing
      ? admin.from("invoices").select("id, invoice_no, status, total_try, due_at, paid_at, created_at").eq("tenant_id", id).order("created_at", { ascending: false }).limit(60)
      : empty,
    access.billing
      ? admin.from("billing_payment_captures").select("id, status, amount_try, captured_at, fulfilled_at, refunded_at").eq("tenant_id", id).order("captured_at", { ascending: false }).limit(60)
      : empty,
    access.tickets
      ? admin.from("support_tickets").select("id, subject, status, priority, created_at, resolved_at").eq("tenant_id", id).order("created_at", { ascending: false }).limit(60)
      : empty,
    access.activity
      ? admin.from("login_events").select("id, user_id, ip, result, created_at").eq("tenant_id", id).order("created_at", { ascending: false }).limit(100)
      : empty,
    admin.from("registration_consents").select("id, user_id, terms_version, kvkk_version, accepted_at, ip_address").eq("tenant_id", id).order("accepted_at", { ascending: false }).limit(40),
    admin.from("iys_consent_events").select("id, channel, from_status, to_status, source, occurred_at").eq("tenant_id", id).order("occurred_at", { ascending: false }).limit(60),
    admin.from("kvkk_erasure_log").select("id, performed_at").eq("tenant_id", id).order("performed_at", { ascending: false }).limit(30),
    admin.from("profiles").select("id, full_name, created_at").eq("tenant_id", id).order("created_at", { ascending: false }).limit(60),
    admin.from("platform_staff").select("id, full_name").limit(200),
  ]);

  const actorNames = new Map<string, string>();
  for (const s of (staffRows.data ?? []) as { id: string; full_name: string }[]) actorNames.set(s.id, `${s.full_name} (EmlakSoft)`);
  for (const p of (profiles.data ?? []) as { id: string; full_name: string | null }[]) if (p.full_name) actorNames.set(p.id, p.full_name);

  return {
    tenantId: id,
    tenantCreatedAt: tenant.created_at,
    tenantName: tenant.name,
    access,
    actorNames,
    audit: (audit.data ?? []) as AuditRow[],
    platformAudit: (platformAudit.data ?? []) as PlatformAuditRow[],
    sub,
    invoices: (invoices.data ?? []) as InvoiceRow[],
    captures: (captures.data ?? []) as CaptureRow[],
    tickets: (tickets.data ?? []) as TicketRow[],
    logins: (logins.data ?? []) as LoginRow[],
    consents: (consents.data ?? []) as ConsentRow[],
    iys: (iys.data ?? []) as IysEventRow[],
    erasures: (erasures.data ?? []) as ErasureRow[],
    profiles: ((profiles.data ?? []) as { id: string; created_at: string }[]).map((p) => ({ id: p.id, created_at: p.created_at })),
  };
}

export type TeamMember = {
  id: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  two_factor_sms: boolean | null;
  created_at: string;
  lastLogin: string | null;
};

export async function loadOfficeTeam(admin: Admin, tenantId: string): Promise<{ members: TeamMember[]; failed30d: number }> {
  const since = daysAgoIso(30);
  const [profiles, logins, failed] = await Promise.all([
    admin.from("profiles").select("id, full_name, role, is_active, two_factor_sms, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: true }).limit(200),
    admin.from("login_events").select("user_id, created_at").eq("tenant_id", tenantId).eq("result", "success").order("created_at", { ascending: false }).limit(1000),
    admin.from("login_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).in("result", ["failed", "2fa_failed"]).gte("created_at", since),
  ]);
  const last = new Map<string, string>();
  for (const l of (logins.data ?? []) as { user_id: string | null; created_at: string }[]) {
    if (l.user_id && !last.has(l.user_id)) last.set(l.user_id, l.created_at);
  }
  const members = ((profiles.data ?? []) as Omit<TeamMember, "lastLogin">[]).map((p) => ({ ...p, lastLogin: last.get(p.id) ?? null }));
  return { members, failed30d: failed.count ?? 0 };
}
