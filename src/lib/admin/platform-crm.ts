import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * OFİS CRM KATMANI (AD5) — sabitler, saf yardımcılar ve okuyucular. Tablolar migration 20261013004400 (yalnız service_role).
 * Bu dosya createAdminClient ÇAĞIRMAZ: yetkili istemci sayfadan/eylemden parametre olarak gelir (office-360 deseni).
 * Tablolar yoksa (migration henüz uygulanmadı) okuyucular `ready: false` döner; ekranlar "CRM kurulumu bekliyor" der,
 * hiçbir şey uydurulmaz.
 */

type Admin = SupabaseClient;

export const LIFECYCLE_STAGES = ["onboarding", "aktif", "risk", "genisleme", "kayip"] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];
export const LIFECYCLE_LABELS: Record<LifecycleStage, string> = {
  onboarding: "Kurulum (onboarding)",
  aktif: "Aktif",
  risk: "Risk",
  genisleme: "Genişleme",
  kayip: "Kayıp",
};
export const LIFECYCLE_TONE: Record<LifecycleStage, "brand" | "success" | "danger" | "gold" | "neutral"> = {
  onboarding: "brand",
  aktif: "success",
  risk: "danger",
  genisleme: "gold",
  kayip: "neutral",
};

export function isLifecycleStage(v: unknown): v is LifecycleStage {
  return typeof v === "string" && (LIFECYCLE_STAGES as readonly string[]).includes(v);
}

/** Aşama elle seçilmediyse ofis durumundan türetilir (ekranda "otomatik" işaretli gösterilir). */
export function derivedStage(status: string): LifecycleStage {
  if (status === "trial") return "onboarding";
  if (status === "past_due" || status === "suspended") return "risk";
  if (status === "cancelled") return "kayip";
  return "aktif";
}

export function effectiveStage(stored: string | null | undefined, status: string): { stage: LifecycleStage; auto: boolean } {
  return isLifecycleStage(stored) ? { stage: stored, auto: false } : { stage: derivedStage(status), auto: true };
}

export const NOTE_CATEGORIES = ["genel", "gorusme", "teknik", "ticari", "risk"] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number];
export const NOTE_CATEGORY_LABELS: Record<NoteCategory, string> = {
  genel: "Genel",
  gorusme: "Görüşme",
  teknik: "Teknik",
  ticari: "Ticari",
  risk: "Risk",
};
export function isNoteCategory(v: unknown): v is NoteCategory {
  return typeof v === "string" && (NOTE_CATEGORIES as readonly string[]).includes(v);
}

export const TAG_COLORS = ["brand", "gold", "success", "warn", "danger", "neutral"] as const;
export type TagColor = (typeof TAG_COLORS)[number];
export const TAG_COLOR_LABELS: Record<TagColor, string> = {
  brand: "Mavi",
  gold: "Altın",
  success: "Yeşil",
  warn: "Turuncu",
  danger: "Kırmızı",
  neutral: "Gri",
};
export function isTagColor(v: unknown): v is TagColor {
  return typeof v === "string" && (TAG_COLORS as readonly string[]).includes(v);
}

export type CrmTag = { id: string; name: string; color: TagColor };
export type CrmStaff = { id: string; name: string; role: string };

const MISSING = /42P01|42883|PGRST205|PGRST202|PGRST200|does not exist|schema cache|Could not find/i;
export function isCrmMissing(err: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(err && MISSING.test(`${err.code ?? ""} ${err.message ?? ""}`));
}

/** Etiket adı: kırpılır, iç boşluk teklenir; 1-40 karakter. */
export function cleanTagName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.replace(/\s+/g, " ").trim();
  return v.length >= 1 && v.length <= 40 ? v : null;
}

/** Etiket, sorumlu personel listesi (filtre + düzenleme seçenekleri). Tablo yoksa ready=false. */
export async function loadCrmCatalog(admin: Admin): Promise<{ ready: boolean; tags: CrmTag[]; staff: CrmStaff[] }> {
  const [tags, staff] = await Promise.all([
    admin.from("tenant_tags").select("id, name, color").order("name", { ascending: true }).limit(200),
    admin.from("platform_staff").select("id, full_name, role").eq("is_active", true).order("full_name", { ascending: true }).limit(200),
  ]);
  return {
    ready: !tags.error,
    tags: tags.error ? [] : ((tags.data ?? []) as { id: string; name: string; color: string }[]).map((t) => ({ id: t.id, name: t.name, color: isTagColor(t.color) ? t.color : "brand" })),
    staff: ((staff.data ?? []) as { id: string; full_name: string; role: string }[]).map((s) => ({ id: s.id, name: s.full_name, role: s.role })),
  };
}

export type CrmRowInfo = { ownerId: string | null; stage: string | null; score: number | null; scoredAt: string | null; tagIds: string[] };

/** Listedeki ofislerin CRM satırları + etiket bağlantıları (tek tur, iki sorgu). Hata = boş harita (kolon "—"). */
export async function loadCrmRows(admin: Admin, tenantIds: readonly string[]): Promise<{ ok: boolean; rows: Map<string, CrmRowInfo> }> {
  const rows = new Map<string, CrmRowInfo>();
  if (tenantIds.length === 0) return { ok: true, rows };
  const ids = [...tenantIds];
  const [crm, links] = await Promise.all([
    admin.from("platform_tenant_crm").select("tenant_id, account_owner_staff_id, lifecycle_stage, health_score, health_scored_at").in("tenant_id", ids),
    admin.from("tenant_tag_links").select("tenant_id, tag_id").in("tenant_id", ids).limit(1000),
  ]);
  if (crm.error || links.error) return { ok: false, rows };
  const get = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { ownerId: null, stage: null, score: null, scoredAt: null, tagIds: [] };
      rows.set(id, r);
    }
    return r;
  };
  for (const c of (crm.data ?? []) as { tenant_id: string; account_owner_staff_id: string | null; lifecycle_stage: string | null; health_score: number | null; health_scored_at: string | null }[]) {
    const r = get(c.tenant_id);
    r.ownerId = c.account_owner_staff_id;
    r.stage = c.lifecycle_stage;
    r.score = c.health_score;
    r.scoredAt = c.health_scored_at;
  }
  for (const l of (links.data ?? []) as { tenant_id: string; tag_id: string }[]) get(l.tenant_id).tagIds.push(l.tag_id);
  return { ok: true, rows };
}

export type CrmNote = {
  id: string;
  category: NoteCategory;
  body: string;
  pinned: boolean;
  authorId: string | null;
  editedAt: string | null;
  createdAt: string;
};

export type CrmTask = {
  id: string;
  tenantId: string | null;
  tenantName?: string | null;
  title: string;
  body: string | null;
  assigneeId: string | null;
  dueAt: string | null;
  status: "open" | "done";
  doneAt: string | null;
  createdAt: string;
};

export type HealthPoint = { day: string; score: number; usage: number; payment: number; support: number; reasons: string[] };

export type OfficeCrm = {
  ready: boolean;
  ownerId: string | null;
  stage: string | null;
  score: number | null;
  scoredAt: string | null;
  tagIds: string[];
  notes: CrmNote[];
  tasks: CrmTask[];
  myTasks: CrmTask[];
  trend: HealthPoint[];
};

const TASK_COLS = "id, tenant_id, title, body, assignee_staff_id, due_at, status, done_at, created_at";

type TaskDb = { id: string; tenant_id: string | null; title: string; body: string | null; assignee_staff_id: string | null; due_at: string | null; status: string; done_at: string | null; created_at: string; tenant?: { name: string } | null };

function toTask(t: TaskDb): CrmTask {
  return {
    id: t.id,
    tenantId: t.tenant_id,
    tenantName: t.tenant?.name ?? null,
    title: t.title,
    body: t.body,
    assigneeId: t.assignee_staff_id,
    dueAt: t.due_at,
    status: t.status === "done" ? "done" : "open",
    doneAt: t.done_at,
    createdAt: t.created_at,
  };
}

/** Ofis 360: CRM başlığı + İlişki sekmesi verisi (tek tur). `withDetail=false` iken not/görev/trend okunmaz (başlık için). */
export async function loadOfficeCrm(admin: Admin, tenantId: string, staffId: string, withDetail: boolean): Promise<OfficeCrm> {
  const empty: OfficeCrm = { ready: false, ownerId: null, stage: null, score: null, scoredAt: null, tagIds: [], notes: [], tasks: [], myTasks: [], trend: [] };
  const none = Promise.resolve({ data: [] as never[], error: null });
  const [crm, links, myTasks, notes, tasks, trend] = await Promise.all([
    admin.from("platform_tenant_crm").select("account_owner_staff_id, lifecycle_stage, health_score, health_scored_at").eq("tenant_id", tenantId).maybeSingle(),
    admin.from("tenant_tag_links").select("tag_id").eq("tenant_id", tenantId),
    admin
      .from("platform_tasks")
      .select(`${TASK_COLS}, tenant:tenants!platform_tasks_tenant_id_fkey(name)`)
      .eq("assignee_staff_id", staffId)
      .eq("status", "open")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(8),
    withDetail
      ? admin.from("platform_tenant_notes").select("id, category, body, pinned, author_staff_id, edited_at, created_at").eq("tenant_id", tenantId).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(100)
      : none,
    withDetail
      ? admin.from("platform_tasks").select(TASK_COLS).eq("tenant_id", tenantId).order("status", { ascending: false }).order("due_at", { ascending: true, nullsFirst: false }).limit(100)
      : none,
    withDetail
      ? admin.from("tenant_health_daily").select("day, score, usage_score, payment_score, support_score, inputs").eq("tenant_id", tenantId).order("day", { ascending: false }).limit(30)
      : none,
  ]);
  if (crm.error && isCrmMissing(crm.error)) return empty;
  const c = crm.data as { account_owner_staff_id: string | null; lifecycle_stage: string | null; health_score: number | null; health_scored_at: string | null } | null;
  return {
    ready: true,
    ownerId: c?.account_owner_staff_id ?? null,
    stage: c?.lifecycle_stage ?? null,
    score: c?.health_score ?? null,
    scoredAt: c?.health_scored_at ?? null,
    tagIds: ((links.data ?? []) as { tag_id: string }[]).map((l) => l.tag_id),
    notes: ((notes.data ?? []) as { id: string; category: string; body: string; pinned: boolean; author_staff_id: string | null; edited_at: string | null; created_at: string }[]).map((n) => ({
      id: n.id,
      category: isNoteCategory(n.category) ? n.category : "genel",
      body: n.body,
      pinned: n.pinned,
      authorId: n.author_staff_id,
      editedAt: n.edited_at,
      createdAt: n.created_at,
    })),
    tasks: ((tasks.data ?? []) as TaskDb[]).map(toTask),
    myTasks: ((myTasks.data ?? []) as unknown as TaskDb[]).map(toTask),
    trend: ((trend.data ?? []) as { day: string; score: number; usage_score: number; payment_score: number; support_score: number; inputs: { reasons?: unknown } | null }[])
      .map((t) => ({
        day: t.day,
        score: t.score,
        usage: t.usage_score,
        payment: t.payment_score,
        support: t.support_score,
        reasons: Array.isArray(t.inputs?.reasons) ? (t.inputs!.reasons as unknown[]).filter((r): r is string => typeof r === "string") : [],
      }))
      .reverse(),
  };
}

// ---- Kayıtlı görünümler (admin kapsamı) ------------------------------------------------------------

/** Rota başına kaydedilebilen URL parametreleri (sayfalama bilinçli olarak yok). */
export const ADMIN_VIEW_PARAMS: Record<string, readonly string[]> = {
  "/admin/tenants": ["q", "durum", "plan", "veri", "yeni", "deneme", "gun", "etiket", "sorumlu", "asama", "skor"],
};

export type AdminSavedView = { id: string; name: string; params: Record<string, string> };

export function sanitizeViewParams(route: string, params: unknown): Record<string, string> | null {
  const allowed = ADMIN_VIEW_PARAMS[route];
  if (!allowed) return null;
  const src = (params ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of allowed) {
    const v = src[k];
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t) out[k] = t.slice(0, 120);
  }
  return out;
}

export function viewHref(route: string, params: Record<string, string>): string {
  const sp = new URLSearchParams(params);
  const s = sp.toString();
  return s ? `${route}?${s}` : route;
}

// ---- Ofis 360 görünüm modeli (sunucuda etiketlenir; istemci bileşeni saat okumaz) -------------------

export type CrmTaskView = CrmTask & { dueLabel: string | null; overdue: boolean; assigneeName: string | null };
export type CrmNoteView = CrmNote & { authorName: string | null; createdLabel: string; editedLabel: string | null };

const fmtDateTime = (iso: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(iso));

export function taskView(t: CrmTask, nowMs: number, staffName: (id: string) => string | null): CrmTaskView {
  return {
    ...t,
    dueLabel: t.dueAt ? fmtDateTime(t.dueAt) : null,
    overdue: Boolean(t.status === "open" && t.dueAt && Date.parse(t.dueAt) < nowMs),
    assigneeName: t.assigneeId ? staffName(t.assigneeId) : null,
  };
}

export function noteView(n: CrmNote, staffName: (id: string) => string | null): CrmNoteView {
  return { ...n, authorName: n.authorId ? staffName(n.authorId) : null, createdLabel: fmtDateTime(n.createdAt), editedLabel: n.editedAt ? fmtDateTime(n.editedAt) : null };
}

export async function loadAdminSavedViews(admin: Admin, staffId: string, route: string): Promise<AdminSavedView[]> {
  const { data, error } = await admin.from("admin_saved_views").select("id, name, params").eq("staff_id", staffId).eq("route", route).order("created_at", { ascending: true }).limit(50);
  if (error) return [];
  return ((data ?? []) as { id: string; name: string; params: unknown }[]).map((v) => ({ id: v.id, name: v.name, params: sanitizeViewParams(route, v.params) ?? {} }));
}
