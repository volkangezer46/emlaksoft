import { z } from "zod";
import { ONBOARDING_STEP_DEFS, type OnboardingStepDef } from "@/lib/onboarding-steps";
import { TOURS, type TourDef, type TourStepDef } from "@/lib/product-tour-data";
import type { TourId } from "@/lib/product-tour-roles";
import { ONBOARDING_CONTENT_KEY } from "@/lib/settings/registry/onboarding";

/**
 * ÜRÜN TURU ve KURULUM KONTROL LİSTESİ İÇERİĞİ — adminden düzenlenen veri (SAF: DB/zaman yok; sunucu ve admin istemcisi ortak).
 *
 * Varsayılanlar KODDA kalır (`product-tour-data.ts` TOURS, `onboarding-steps.ts` ONBOARDING_STEP_DEFS) ve her zaman yedektir:
 * ayar boş/bozuksa ya da bir tur/adım hiç düzenlenmediyse kod içeriği kullanılır. Düzenlenen içerik ayar defterinde tek JSON
 * değerdir (`onboarding.content`, platform_settings; geçmiş + denetim izi ayar defterinden). Yazım yalnız
 * `/admin/tenants/kurulum?sekme=icerik` düzenleyicisinden (köprü ayar).
 *
 *  - Tur: adım listesi TAMAMEN değiştirilebilir (metin, sayfa, seçici, sıra, açık/kapalı, rol ve paket hedefleme, yeni adım).
 *    Turun hangi rollere varsayılan olduğu kodda kalır (`TOUR_ROLES`); adımın rol hedefi o rolleri yalnız DARALTIR.
 *  - Kurulum adımı: metin (kısa ad, başlık, açıklama), hedef sayfa, sıra, açık/kapalı, rol ve paket hedefleme. Adım EKLENEMEZ:
 *    "tamamlandı" kuralı (`isDone`) ve gerekli yetki (`requires`) koddadır; kodda yeni adım eklenince listeye kendiliğinden düşer.
 * Hedefleme: boş liste = herkes. Rol bilinmiyorsa (ofis düzeyi ilerleme) rol hedefi uygulanmaz; paket bilinmiyorsa paket hedefi.
 */

export { ONBOARDING_CONTENT_KEY };

const TOUR_IDS = ["ofis-sahibi", "yonetici", "muhasebe", "danisman"] as const satisfies readonly TourId[];

/** Tur adımı sayfası: menüdeki bir /app yolu (sorgu yok; menü eşleşmesi yolla yapılır). */
export const TOUR_PATH_RE = /^\/app(\/[a-z0-9-]+)*$/;
/** Kurulum adımı hedefi: /app yolu, isteğe bağlı basit sorgu (ör. `/app/giderler?sekme=duzenli`). */
export const STEP_HREF_RE = /^\/app(\/[a-z0-9-]+)*(\?[a-z0-9=&_-]+)?$/i;

const targets = {
  roles: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  plans: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
};

export const tourStepSchema = z.object({
  path: z.string().trim().max(200).regex(TOUR_PATH_RE, "Sayfa /app ile başlayan bir menü yolu olmalı (ör. /app/musteriler)."),
  selectors: z.array(z.string().trim().min(1).max(200)).min(1, "En az bir hedef öğe seçicisi girin.").max(5),
  title: z.string().trim().min(1, "Adım başlığı boş olamaz.").max(80),
  desc: z.string().trim().min(1, "Adım açıklaması boş olamaz.").max(400),
  descMobile: z.string().trim().max(400).optional(),
  enabled: z.boolean().default(true),
  ...targets,
});

export const tourContentSchema = z.object({
  label: z.string().trim().min(1, "Tur adı boş olamaz.").max(60),
  description: z.string().trim().max(200).default(""),
  steps: z.array(tourStepSchema).max(12, "Bir turda en çok 12 adım olabilir."),
});

export const checklistStepSchema = z.object({
  id: z.string().trim().min(1).max(60),
  short: z.string().trim().min(1, "Kısa ad boş olamaz.").max(30),
  title: z.string().trim().min(1, "Adım başlığı boş olamaz.").max(80),
  description: z.string().trim().min(1, "Adım açıklaması boş olamaz.").max(300),
  href: z
    .string()
    .trim()
    .max(200)
    .regex(STEP_HREF_RE, "Hedef sayfa /app ile başlamalı (ör. /app/giderler?sekme=duzenli).")
    .optional(),
  enabled: z.boolean().default(true),
  ...targets,
});

export const onboardingContentSchema = z.object({
  v: z.literal(1).default(1),
  tours: z
    .object({
      "ofis-sahibi": tourContentSchema.optional(),
      yonetici: tourContentSchema.optional(),
      muhasebe: tourContentSchema.optional(),
      danisman: tourContentSchema.optional(),
    })
    .default({}),
  /** Sıralı tam liste; bilinmeyen kimlik atılır, listede olmayan kod adımı sona eklenir. Yoksa kod sırası/metni. */
  checklist: z.array(checklistStepSchema).max(40).optional(),
});

export type TourStepContent = z.infer<typeof tourStepSchema>;
export type TourContent = z.infer<typeof tourContentSchema>;
export type ChecklistStepContent = z.infer<typeof checklistStepSchema>;
export type OnboardingContent = z.infer<typeof onboardingContentSchema>;

/** Düzenleyicinin tam görünümü: dört tur + tüm kurulum adımları (varsayılanlarla doldurulmuş). */
export type OnboardingContentFull = {
  tours: Record<TourId, TourContent>;
  checklist: ChecklistStepContent[];
};

export type TargetCtx = { role?: string | null; plan?: string | null };

export const EMPTY_ONBOARDING_CONTENT: OnboardingContent = { v: 1, tours: {} };

/** Depodaki ham metni çözer; boş/bozuk = boş içerik (kod varsayılanları). Asla fırlatmaz. */
export function parseOnboardingContent(raw: string | null | undefined): OnboardingContent {
  const text = (raw ?? "").trim();
  if (!text) return EMPTY_ONBOARDING_CONTENT;
  try {
    const parsed = onboardingContentSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : EMPTY_ONBOARDING_CONTENT;
  } catch {
    return EMPTY_ONBOARDING_CONTENT;
  }
}

/** Hedefleme: boş liste herkes; bağlam değeri bilinmiyorsa (null/undefined) o hedef uygulanmaz. */
export function matchesTarget(t: { roles?: readonly string[]; plans?: readonly string[] }, ctx: TargetCtx): boolean {
  const roles = t.roles ?? [];
  const plans = t.plans ?? [];
  if (roles.length > 0 && typeof ctx.role === "string" && !roles.includes(ctx.role)) return false;
  if (plans.length > 0 && typeof ctx.plan === "string" && !plans.includes(ctx.plan)) return false;
  return true;
}

/* --------------------------------- Varsayılanlar --------------------------------- */

function defaultTourStep(s: TourStepDef): TourStepContent {
  return {
    path: s.path,
    selectors: [...s.selectors],
    title: s.title,
    desc: s.desc,
    ...(s.descMobile ? { descMobile: s.descMobile } : {}),
    enabled: true,
    roles: [],
    plans: [],
  };
}

export function defaultTourContent(tour: TourDef): TourContent {
  return { label: tour.label, description: tour.description, steps: tour.steps.map(defaultTourStep) };
}

function defaultChecklistStep(d: OnboardingStepDef): ChecklistStepContent {
  return {
    id: d.id,
    short: d.short,
    title: d.title,
    description: d.description,
    ...(d.href ? { href: d.href } : {}),
    enabled: true,
    roles: [],
    plans: [],
  };
}

const CODE_STEPS = ONBOARDING_STEP_DEFS as readonly OnboardingStepDef[];

export function defaultChecklistContent(): ChecklistStepContent[] {
  return CODE_STEPS.map(defaultChecklistStep);
}

/** Kayıtlı kontrol listesini kod adımlarıyla hizalar: bilinmeyen kimlik atılır, eksik kod adımı varsayılanıyla sona eklenir. */
function alignChecklist(saved: readonly ChecklistStepContent[] | undefined): ChecklistStepContent[] {
  if (!saved) return defaultChecklistContent();
  const known = new Map(CODE_STEPS.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const out: ChecklistStepContent[] = [];
  for (const s of saved) {
    if (!known.has(s.id) || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  for (const d of CODE_STEPS) if (!seen.has(d.id)) out.push(defaultChecklistStep(d));
  return out;
}

/** Düzenleyici için tam içerik (kayıtlı + varsayılan). */
export function materializeOnboardingContent(content: OnboardingContent): OnboardingContentFull {
  const tours = {} as Record<TourId, TourContent>;
  for (const t of TOURS) tours[t.id] = content.tours[t.id] ?? defaultTourContent(t);
  return { tours, checklist: alignChecklist(content.checklist) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Kaydedilecek içerik: varsayılanla AYNI tur/kontrol listesi yazılmaz (kod metni sonradan değişirse o kısım koddan gelmeye
 * devam eder). Hepsi varsayılansa boş içerik döner (çağıran null yazar = varsayılana dön).
 */
export function compactOnboardingContent(full: OnboardingContentFull): OnboardingContent {
  const tours: OnboardingContent["tours"] = {};
  for (const t of TOURS) {
    const edited = full.tours[t.id];
    if (edited && !same(edited, defaultTourContent(t))) tours[t.id] = edited;
  }
  const checklist = alignChecklist(full.checklist);
  return {
    v: 1,
    tours,
    ...(same(checklist, defaultChecklistContent()) ? {} : { checklist }),
  };
}

export function isEmptyOnboardingContent(c: OnboardingContent): boolean {
  return Object.keys(c.tours).length === 0 && !c.checklist;
}

/** Düzenleyiciden gelen tam içeriği doğrular (Türkçe ilk hata). */
export function validateOnboardingContentFull(input: unknown):
  | { ok: true; value: OnboardingContentFull }
  | { ok: false; error: string } {
  const schema = z.object({
    tours: z.object({
      "ofis-sahibi": tourContentSchema,
      yonetici: tourContentSchema,
      muhasebe: tourContentSchema,
      danisman: tourContentSchema,
    }),
    checklist: z.array(checklistStepSchema).max(40),
  });
  const parsed = schema.safeParse(dropEmptyOptionals(input));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issueWhere(issue?.path ?? []);
    return { ok: false, error: `${where}${issue?.message ?? "Geçersiz içerik."}` };
  }
  const ids = parsed.data.checklist.map((s) => s.id);
  if (new Set(ids).size !== ids.length) return { ok: false, error: "Kurulum adımları yinelenemez." };
  const known = new Set(CODE_STEPS.map((d) => d.id));
  if (ids.some((id) => !known.has(id))) return { ok: false, error: "Bilinmeyen kurulum adımı; sayfayı yenileyip tekrar deneyin." };
  return { ok: true, value: parsed.data as OnboardingContentFull };
}

/** Boş bırakılan isteğe bağlı metin (mobil açıklama, hedef sayfa) alan olarak hiç yazılmaz: varsayılanla karşılaştırma tutar. */
function dropEmptyOptionals(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const strip = (o: unknown, key: string) => {
    if (o && typeof o === "object" && key in o) {
      const v = (o as Record<string, unknown>)[key];
      if (v == null || (typeof v === "string" && v.trim() === "")) delete (o as Record<string, unknown>)[key];
    }
  };
  const copy = JSON.parse(JSON.stringify(input)) as { tours?: Record<string, { steps?: unknown[] }>; checklist?: unknown[] };
  for (const t of Object.values(copy.tours ?? {})) for (const s of t?.steps ?? []) strip(s, "descMobile");
  for (const s of copy.checklist ?? []) strip(s, "href");
  return copy;
}

function issueWhere(path: readonly PropertyKey[]): string {
  if (path[0] === "tours" && typeof path[1] === "string") {
    const tour = TOURS.find((t) => t.id === path[1]);
    const step = path[2] === "steps" && typeof path[3] === "number" ? ` · ${path[3] + 1}. adım` : "";
    return `${tour?.label ?? "Tur"}${step}: `;
  }
  if (path[0] === "checklist" && typeof path[1] === "number") return `Kurulum ${path[1] + 1}. adım: `;
  return "";
}

/* --------------------------------- Çözümleme --------------------------------- */

/**
 * Kullanıcıya çalıştırılacak turlar: kayıtlı içerik (yoksa kod) + açık/kapalı + rol/paket hedefi. Rol eşlemesi kodda kalır.
 * Menü/yetki elemesi ayrıca `resolveTourSteps` ile istemcide yapılır.
 */
export function resolveTours(content: OnboardingContent, ctx: TargetCtx): TourDef[] {
  return TOURS.map((t) => {
    const c = content.tours[t.id];
    if (!c) return t;
    return {
      ...t,
      label: c.label,
      description: c.description || t.description,
      steps: c.steps
        .filter((s) => s.enabled && matchesTarget(s, ctx))
        .map((s) => ({
          path: s.path,
          selectors: s.selectors,
          title: s.title,
          desc: s.desc,
          ...(s.descMobile ? { descMobile: s.descMobile } : {}),
        })),
    };
  });
}

/**
 * Kurulum sihirbazının adım tanımları: kayıtlı sıra/metin/hedef + açık/kapalı + rol/paket hedefi; tamamlanma kuralı ve
 * yetki koddan. Kayıt yoksa kod listesi aynen döner.
 */
export function resolveChecklistDefs(content: OnboardingContent, ctx: TargetCtx): OnboardingStepDef[] {
  if (!content.checklist) return [...CODE_STEPS];
  const code = new Map(CODE_STEPS.map((d) => [d.id, d]));
  const out: OnboardingStepDef[] = [];
  for (const s of alignChecklist(content.checklist)) {
    const d = code.get(s.id);
    if (!d || !s.enabled || !matchesTarget(s, ctx)) continue;
    out.push({
      id: d.id,
      isDone: d.isDone,
      ...(d.requires ? { requires: d.requires } : {}),
      short: s.short,
      title: s.title,
      description: s.description,
      ...(s.href ? { href: s.href } : {}),
    });
  }
  return out;
}

export const ONBOARDING_TOUR_IDS: readonly TourId[] = TOUR_IDS;
