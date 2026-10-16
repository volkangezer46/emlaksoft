/**
 * Danışman adayı (işe alım) hattı ve yeni danışman oryantasyonu (OA9) — SAF yardımcılar.
 * Aşama sabitleri tek kaynaktır: `src/lib/workflow-state.ts` (RECRUIT_STAGES). DB CHECK'leri
 * `supabase/migrations/20261020050005_recruiting_onboarding.sql` ile aynı listeyi taşır.
 */
import { CLOSED_RECRUIT_STAGES, RECRUIT_STAGES, type RecruitStage } from "@/lib/workflow-state";

export { RECRUIT_STAGES, type RecruitStage };

export const RECRUIT_STAGE_LABEL: Record<RecruitStage, string> = {
  basvuru: "Başvuru",
  gorusme: "Görüşme",
  teklif: "Teklif",
  katildi: "Katıldı",
  red: "Olumsuz",
};

/** Aşama rozet tonu (`tone-*` yardımcı sınıfları). */
export const RECRUIT_STAGE_TONE: Record<RecruitStage, string> = {
  basvuru: "tone-neutral",
  gorusme: "tone-info",
  teklif: "tone-warning",
  katildi: "tone-success",
  red: "tone-danger",
};

/** Aşamanın bir sonraki doğal adımı (birincil düğme). Sonuçlanmışta yok. */
export const RECRUIT_NEXT_STAGE: Partial<Record<RecruitStage, RecruitStage>> = {
  basvuru: "gorusme",
  gorusme: "teklif",
  teklif: "katildi",
};

export const RECRUIT_SOURCES = ["form", "tavsiye", "sosyal_medya", "ilan", "transfer", "diger"] as const;
export type RecruitSource = (typeof RECRUIT_SOURCES)[number];

export const RECRUIT_SOURCE_LABEL: Record<RecruitSource, string> = {
  form: "Kariyer formu",
  tavsiye: "Tavsiye",
  sosyal_medya: "Sosyal medya",
  ilan: "İş ilanı",
  transfer: "Başka ofisten",
  diger: "Diğer",
};

export function isRecruitStage(v: unknown): v is RecruitStage {
  return typeof v === "string" && (RECRUIT_STAGES as readonly string[]).includes(v);
}

export function isRecruitSource(v: unknown): v is RecruitSource {
  return typeof v === "string" && (RECRUIT_SOURCES as readonly string[]).includes(v);
}

export function isClosedRecruitStage(stage: RecruitStage): boolean {
  return CLOSED_RECRUIT_STAGES.includes(stage);
}

/** Hazır olumsuz sonuç nedenleri (serbest metin de girilebilir). */
export const RECRUIT_REJECT_REASONS = [
  "Aday vazgeçti",
  "Deneyim / profil uygun değil",
  "Başka ofisle anlaştı",
  "Ulaşılamadı",
  "Komisyon / şartlarda anlaşılamadı",
] as const;

/** URL filtresi (?asama=) — geçersiz değer süzgeçsiz sayılır. */
export function parseStageFilter(raw: string | string[] | undefined): RecruitStage | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return isRecruitStage(v) ? v : null;
}

export function parseSourceFilter(raw: string | string[] | undefined): RecruitSource | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return isRecruitSource(v) ? v : null;
}

/** Arama terimi: PostgREST `or()` sözdizimini bozan karakterler atılır, 60 karakterle sınırlanır. */
export function sanitizeSearch(raw: string | string[] | undefined): string {
  const v = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  return v.replace(/[%,()*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** Deneyim yılı girdisi: 0-60 tam sayı; boş/geçersiz null. */
export function parseExperience(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 60 ? n : null;
}

// ---------------------------------------------------------------------------
// Oryantasyon
// ---------------------------------------------------------------------------

export type OrientationTemplateItem = {
  title: string;
  description: string | null;
  /** İşe başlangıçtan kaç gün sonra tamamlanmalı (0 = ilk gün). */
  offsetDays: number;
};

/**
 * Ofis kendi şablonunu kaydetmediyse kullanılan varsayılan oryantasyon listesi (Türkiye emlak ofisi pratiği:
 * yetki belgesi, KVKK taahhüdü, portal hesapları, kartvizit, ilk 30 gün değerlendirmesi).
 */
export const DEFAULT_ORIENTATION: readonly OrientationTemplateItem[] = [
  { title: "Ofis tanıtımı ve ekiple tanışma", description: "Ofis kuralları, çalışma saatleri, nöbet düzeni ve ekip arkadaşlarıyla tanışma.", offsetDays: 0 },
  { title: "KVKK ve gizlilik taahhüdünü imzalama", description: "Müşteri verisinin işlenmesi ve ofis gizlilik kuralları.", offsetDays: 1 },
  { title: "EmlakSoft eğitimi: müşteri, talep ve portföy kaydı", description: "Kendi müşteri ve portföylerinizi uygulamaya girme, görev ve randevu takibi.", offsetDays: 2 },
  { title: "Yetki belgesi (TTYB) bilgilerini girme", description: "Taşınmaz ticareti yetki belgesi numarası ve bitiş tarihi Kişisel bilgiler sekmesine girilir.", offsetDays: 3 },
  { title: "Dijital kartviziti yayınlama", description: "Fotoğraf, unvan ve iletişim bilgileriyle kartvizit sayfasını açma.", offsetDays: 3 },
  { title: "Portal hesaplarının açılması", description: "Sahibinden, Hepsiemlak, Emlakjet gibi portallarda danışman hesabı ve ofis bağlantısı.", offsetDays: 5 },
  { title: "Bölge turu ve ofis portföylerini tanıma", description: "Ofisin aktif portföylerini yerinde görme, bölge fiyat seviyesini öğrenme.", offsetDays: 7 },
  { title: "İlk portföy görüşmesi", description: "Bir mal sahibiyle ilk yetki/portföy görüşmesini yapma (deneyimli bir danışmanla birlikte olabilir).", offsetDays: 14 },
  { title: "Mesleki yeterlilik (MYK) belgesi durumunu kontrol", description: "Belge yoksa sınav planı yapılır.", offsetDays: 21 },
  { title: "30. gün birebir değerlendirme", description: "Yöneticiyle ilk ayın değerlendirmesi ve sonraki hedefler.", offsetDays: 30 },
];

export const ORIENTATION_MAX_ITEMS = 30;

/** Şablon satırlarını doğrular: boş başlık atılır, başlık 160 / açıklama 500 karakter, gün 0-180. */
export function parseTemplateRows(
  titles: FormDataEntryValue[],
  descriptions: FormDataEntryValue[],
  offsets: FormDataEntryValue[],
): OrientationTemplateItem[] {
  const out: OrientationTemplateItem[] = [];
  for (let i = 0; i < titles.length && out.length < ORIENTATION_MAX_ITEMS; i += 1) {
    const title = String(titles[i] ?? "").trim().slice(0, 160);
    if (!title) continue;
    const description = String(descriptions[i] ?? "").trim().slice(0, 500) || null;
    const raw = Number.parseInt(String(offsets[i] ?? "0"), 10);
    const offsetDays = Number.isFinite(raw) ? Math.min(180, Math.max(0, raw)) : 0;
    out.push({ title, description, offsetDays });
  }
  return out;
}

/** "YYYY-MM-DD" + gün → "YYYY-MM-DD" (UTC aritmetiği; tarih anahtarı saat taşımaz). */
export function addDaysKey(dayKey: string, days: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Oryantasyon görevinin son tarihi: Türkiye saatiyle o gün 10:00. */
export function orientationDueIso(dayKey: string): string {
  return new Date(`${dayKey}T10:00:00+03:00`).toISOString();
}

export type OrientationProgressItem = { done_at: string | null; due_on: string | null; task_status?: string | null };

/** Adım tamam mı: elle işaretlendi ya da bağlı görev tamamlandı (görevler sayfasından kapatılmış olabilir). */
export function isOrientationItemDone(item: OrientationProgressItem): boolean {
  return Boolean(item.done_at) || item.task_status === "done";
}

export function orientationProgress(items: readonly OrientationProgressItem[], todayKey: string) {
  const total = items.length;
  const done = items.filter(isOrientationItemDone).length;
  const overdue = items.filter((i) => !isOrientationItemDone(i) && i.due_on !== null && i.due_on < todayKey).length;
  return { total, done, overdue, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Tablo yok / şema önbelleğinde yok hatası (kod migration'dan önce yayınlanabilir). */
export function isMissingRecruitSchema(e: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(
    e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" || /recruit_|onboarding_/.test(e.message ?? "")),
  );
}
