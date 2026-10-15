/**
 * "Sıradaki en iyi eylem" — saf karar mantığı (DB'ye ve React'e bağımlı değil; vitest kapsamında).
 *
 * Öncelik sırası (tek kaynak): bugünkü randevu → gecikmiş görev → dönüş bekleyen sıcak müşteri →
 * yetki belgesi bitişi → 7+ gün teyitsiz ilan → bekleyen komisyon → kurulumun eksik adımı →
 * hiçbiri yoksa rolün yedek eylemi ("Müşteri ekle"; müşteri ekleyemeyene "Komisyonları aç" / "Müşterilere göz at").
 * Yalnız GERÇEK sayı > 0 olan adım aday olur (sahte vaat yok). Her aday ve yedek, götürdüğü sayfanın izniyle süzülür:
 * kullanıcının açamayacağı sayfaya giden düğme çizilmez (`home-href-contract.test.ts`).
 */

import type { OnboardingState } from "@/lib/onboarding-checklist";
import type { AppAction, AppModule } from "@/lib/permissions";
import type { EffectivePermissions } from "@/lib/permissions-effective";

export type NextActionTone = "brand" | "danger" | "warn" | "success";

export type NextAction = {
  key: string;
  /** Büyük düğmenin etiketi. */
  label: string;
  /** Kartın başlığı (tek cümle). */
  title: string;
  /** Neden şimdi — gerçek sayıdan türeyen açıklama. */
  reason: string;
  href: string;
  tone: NextActionTone;
};

export type NextActionInput = {
  appointmentsToday: number;
  firstAppointment: { time: string; type: string } | null;
  tasksOverdue: number;
  hotLeads: number;
  expiringAuthority: number;
  unconfirmedListings: number;
  /** Yalnız kullanıcı kendi (ya da earnings_all ile ofis) komisyonunu görebiliyorsa > 0 verilir. */
  pendingCommissionText: string | null;
  onboardingNext: { title: string; href: string } | null;
  /** Etkin izinler: verilirse her aday götürdüğü sayfanın izniyle süzülür ve yedek eylem role göre seçilir. */
  perms?: EffectivePermissions;
};

type Need = { module: AppModule; action: AppAction };

/** Aday eylemin götürdüğü sayfanın kapısı (sayfanın `requireModulePage` modülü + gereken eylem). */
const ACTION_NEEDS: Readonly<Record<string, Need>> = {
  randevu: { module: "appointments", action: "view" },
  gorev: { module: "tasks", action: "view" },
  sicak: { module: "customers", action: "view" },
  yetki: { module: "properties", action: "view" },
  teyit: { module: "portals", action: "view" },
  komisyon: { module: "commissions", action: "view" },
  kurulum: { module: "dashboard", action: "view" },
};

function allows(perms: EffectivePermissions | undefined, need: Need | undefined): boolean {
  return !perms || !need || (perms[need.module] ?? []).includes(need.action);
}

export const FALLBACK_ACTION_KEY = "musteri-ekle";

/**
 * Kurulum adayı: yetkiye göre DARALTILMIŞ durumdan (loadOnboardingState → scopeOnboardingToPermissions) sıradaki adım.
 * Kurulum bitmiş/oturmuşsa ya da kullanıcının yapabileceği eksik adım yoksa null (aday olmaz).
 */
export function onboardingNextOf(state: OnboardingState | null): NextActionInput["onboardingNext"] {
  if (!state || state.complete || state.settled) return null;
  const step = state.steps.find((s) => s.id === state.nextId) ?? state.steps.find((s) => !s.done);
  return step ? { title: step.title, href: `/app/baslangic?adim=${step.id}` } : null;
}

export const FALLBACK_ACTION: NextAction = {
  key: FALLBACK_ACTION_KEY,
  label: "Müşteri ekle",
  title: "Bugün için bekleyen iş görünmüyor",
  reason: "Yeni bir müşteri eklemek hattı canlı tutar.",
  href: "/app/hizli?sekme=musteri",
  tone: "brand",
};

/**
 * Rolün yedek eylemi (anahtar her zaman `FALLBACK_ACTION_KEY`: "Bugün için geç" ile atlanmaz). Müşteri ekleyebilen
 * "Müşteri ekle"; ekleyemeyen muhasebe "Komisyonları aç"; salt okunur "Müşterilere göz at"; hiçbiri yoksa "Görevleri aç"
 * ya da en son ana ekranın kendisi (her rolün açabildiği tek sayfa).
 */
export function fallbackActionFor(perms: EffectivePermissions | undefined): NextAction {
  const can = (module: AppModule, action: AppAction) => allows(perms, { module, action });
  if (can("customers", "create")) return FALLBACK_ACTION;
  const base = { key: FALLBACK_ACTION_KEY, title: "Bugün için bekleyen iş görünmüyor", tone: "brand" as const };
  if (can("commissions", "edit"))
    return { ...base, label: "Komisyonları aç", reason: "Tahsilatı bekleyen komisyonları kontrol etmek kasayı güncel tutar.", href: "/app/komisyon" };
  if (can("customers", "view"))
    return { ...base, label: "Müşterilere göz at", reason: "Ofisin müşteri listesine ve son hareketlere buradan bakabilirsiniz.", href: "/app/musteriler" };
  if (can("tasks", "view"))
    return { ...base, label: "Görevleri aç", reason: "Ofisin açık görevlerini buradan izleyebilirsiniz.", href: "/app/gorevler" };
  return { ...base, label: "Ana ekranı yenile", reason: "Yeni bir iş geldiğinde burada görünür.", href: "/app" };
}

/** Aday eylemler öncelik sırasıyla; her zaman son eleman sönmez yedek eylemdir. */
export function buildNextActions(i: NextActionInput): NextAction[] {
  const out: NextAction[] = [];
  if (i.appointmentsToday > 0) {
    const first = i.firstAppointment;
    out.push({
      key: "randevu",
      label: "Randevulara git",
      title: i.appointmentsToday === 1 ? "Bugün 1 randevun var" : `Bugün ${i.appointmentsToday} randevun var`,
      reason: first ? `İlki ${first.time} · ${first.type}` : "Hazırlığını yap, müşteriyi önceden teyit et.",
      href: "/app/randevular?gorunum=gun",
      tone: "brand",
    });
  }
  if (i.tasksOverdue > 0) {
    out.push({
      key: "gorev",
      label: "Gecikenleri aç",
      title: `${i.tasksOverdue} görevin gecikmiş`,
      reason: "Önce bunları kapat; geciken iş müşteriye geç dönüş demektir.",
      href: "/app/gorevler?filter=overdue&mine=1",
      tone: "danger",
    });
  }
  if (i.hotLeads > 0) {
    out.push({
      key: "sicak",
      label: "Müşterileri ara",
      title: `${i.hotLeads} sıcak müşteri dönüş bekliyor`,
      reason: "Sıcak müşteri beklemez; bugün bir arama dönüşümü belirler.",
      href: "/app/musteriler?sort=hot",
      tone: "success",
    });
  }
  if (i.expiringAuthority > 0) {
    out.push({
      key: "yetki",
      label: "Portföyleri gör",
      title: `${i.expiringAuthority} portföyün yetkisi 15 gün içinde doluyor`,
      reason: "Yetki yenilenmezse portföy elden çıkabilir.",
      href: "/app/portfoyler",
      tone: "warn",
    });
  }
  if (i.unconfirmedListings > 0) {
    out.push({
      key: "teyit",
      label: "İlanları teyit et",
      title: `${i.unconfirmedListings} ilan 7+ gündür teyitsiz`,
      reason: "Portallarda yayında görünmeyen ilan müşteri kaçırır.",
      href: "/app/ilan-kontrol/portallar?durum=teyit",
      tone: "warn",
    });
  }
  if (i.pendingCommissionText) {
    out.push({
      key: "komisyon",
      label: "Komisyonu aç",
      title: `${i.pendingCommissionText} komisyon tahsilat bekliyor`,
      reason: "Tahsilat takibi yapılmayan komisyon gecikir.",
      href: "/app/komisyon?durum=bekleyen",
      tone: "warn",
    });
  }
  if (i.onboardingNext) {
    out.push({
      key: "kurulum",
      label: "Adımı tamamla",
      title: `Kurulumun sıradaki adımı: ${i.onboardingNext.title}`,
      reason: "Kurulum tamamlandıkça ekran sana daha doğru işler önerir.",
      href: i.onboardingNext.href,
      tone: "brand",
    });
  }
  const permitted = out.filter((a) => allows(i.perms, ACTION_NEEDS[a.key]));
  permitted.push(fallbackActionFor(i.perms));
  return permitted;
}

/** "Bugün için geç" ile atlananlar dışındaki ilk eylem; yedek eylem hiç atlanamaz. */
export function pickNextAction(actions: readonly NextAction[], dismissed: readonly string[]): NextAction {
  const skip = new Set(dismissed);
  return actions.find((a) => a.key === FALLBACK_ACTION_KEY || !skip.has(a.key)) ?? actions[actions.length - 1] ?? FALLBACK_ACTION;
}

/** Görev paneli boş durumunun düğmesi: yalnız görev oluşturabilene ("Görev ekle"); yoksa düğme yok. */
export function taskEmptyAction(perms: EffectivePermissions | undefined): { href: string; label: string } | null {
  return allows(perms, { module: "tasks", action: "create" }) ? { href: "/app/gorevler", label: "Görev ekle" } : null;
}

export const SKIP_COOKIE = "es_eylem_gec";

/** Çerez değeri `GÜN|anahtar,anahtar`; gün bugünkü değilse (eski çerez) boş liste. */
export function parseSkipCookie(value: string | undefined, todayKey: string): string[] {
  if (!value) return [];
  const [day, keys] = value.split("|");
  if (day !== todayKey || !keys) return [];
  return keys.split(",").filter((k) => /^[a-z-]{1,24}$/.test(k));
}

export function serializeSkipCookie(todayKey: string, keys: readonly string[]): string {
  return `${todayKey}|${[...new Set(keys)].join(",")}`;
}
