import { ICONS } from "@/lib/icons";
import { featureForHref } from "@/lib/modules/registry";
import { navSearchText, PALETTE_ONLY_PAGES, visibleSections, type NavIcon } from "@/lib/nav-config";
import type { AppModule } from "@/lib/permissions";
import { ACCENTS, writeAccentPref, writeThemePref, type AccentPref, type ThemePref } from "@/lib/theme";
import { writeUiPrefsCookie, type UiPrefs } from "@/lib/ui-prefs";

/**
 * Komut paletleri (/app ve /admin) için ortak mantık: arama süzgeci, yetkiye göre
 * "Git" / "Eylemler" listeleri, "Görünüm" komutları (tema, vurgu rengi, sade görünüm;
 * yazı boyutu Kaydet gerektirdiği için menüdeki Görünüm panelindedir) ve localStorage destekli "Son görülenler" deposu.
 * İki palet farklı arama kaynaklarına sahip olduğundan görünüm ayrı kalır;
 * veri ve davranış burada tek yerdedir.
 */

/** Komut paleti "Ayarlar" grubu: ayar arama sonuçlarının grup adı (sonuçlar sunucudan, registry indeksinden ve rol filtreli gelir). */
export const PALETTE_SETTINGS_GROUP = "Ayarlar";

/**
 * Komut paletini açan olay (ikinci bir arama kutusu YOK): yan menüdeki arama düğmesi ve ana ekran kutusu gönderir.
 * İsteğe bağlı `detail: { q?: string }` başlangıç metnidir (bkz. `openPalette`).
 */
export const OPEN_PALETTE_EVENT = "es-open-palette";

export type PaletteEntry = {
  label: string;
  href: string;
  icon: NavIcon;
  /** Klavye kısayolu ("n m", "g p"); palet satırında rozet olarak gösterilir. */
  shortcut?: string;
  /** Satırın altında görünen tek cümle (nav-config `description`). */
  description?: string;
};

/** Türkçe duyarlı (İ/ı) büyük-küçük harf bağımsız içerme kontrolü. */
export function matchesQuery(label: string, q: string): boolean {
  const needle = q.trim().toLocaleLowerCase("tr-TR");
  if (!needle) return true;
  return label.toLocaleLowerCase("tr-TR").includes(needle);
}

/**
 * Üst çubuk "Yeni" menüsü ve komut paleti "Eylemler" grubunun TEK kaynağı: her `/yeni`
 * sayfası (16) + görüşme kaydı. `shortcut`, keyboard-shortcuts.tsx'teki `n` önekli
 * dizilerle birebir aynıdır (kısayol sözleşme testi bunu doğrular).
 */
export type AppAction = PaletteEntry & { module: AppModule };

export const APP_ACTIONS: readonly AppAction[] = [
  { label: "Hızlı kayıt", href: "/app/hizli", icon: ICONS.hizli, module: "customers", shortcut: "n h" },
  { label: "Yeni müşteri", href: "/app/musteriler/yeni", icon: ICONS.musteri, module: "customers", shortcut: "n m" },
  { label: "Yeni talep", href: "/app/talepler/yeni", icon: ICONS.talep, module: "demands", shortcut: "n t" },
  { label: "Yeni portföy", href: "/app/portfoyler/yeni", icon: ICONS.portfoy, module: "properties", shortcut: "n p" },
  { label: "Yeni randevu", href: "/app/randevular/yeni", icon: ICONS.randevu, module: "appointments", shortcut: "n r" },
  { label: "Yeni görev", href: "/app/gorevler/yeni", icon: ICONS.gorev, module: "tasks", shortcut: "n g" },
  { label: "Yeni anlaşma", href: "/app/anlasmalar/yeni", icon: ICONS.anlasma, module: "commissions", shortcut: "n a" },
  { label: "Yeni teklif", href: "/app/teklifler/yeni", icon: ICONS.teklif, module: "offers" },
  { label: "Yeni sözleşme", href: "/app/sozlesmeler/yeni", icon: ICONS.sozlesme, module: "contracts" },
  { label: "Yeni kiralama", href: "/app/kiralama/yeni", icon: ICONS.anahtar, module: "rentals" },
  { label: "Yeni proje", href: "/app/projeler/yeni", icon: ICONS.proje, module: "projects" },
  { label: "Yeni açık ev", href: "/app/acik-ev/yeni", icon: ICONS.acikEv, module: "open_house" },
  { label: "Yeni sunum", href: "/app/portfoyler/sunumlar/yeni", icon: ICONS.sunum, module: "properties" },
  { label: "Yeni kampanya", href: "/app/kampanyalar/yeni", icon: ICONS.mesaj, module: "campaigns" },
  { label: "Yeni onay talebi", href: "/app/onaylar/yeni", icon: ICONS.onay, module: "commissions" },
  { label: "Yeni otomasyon", href: "/app/otomasyonlar/yeni", icon: ICONS.otomasyon, module: "settings" },
  { label: "Yeni danışman", href: "/app/ekip/yeni", icon: ICONS.ekip, module: "team" },
  { label: "Yeni destek talebi", href: "/app/destek/yeni", icon: ICONS.destek, module: "support" },
  { label: "Görüşme kaydet", href: "/app/arama", icon: ICONS.telefon, module: "calls" },
  // Toplu kayıt eylemi (menü öğesi değil; Müşteriler/Portföyler başlığındaki "İçe aktar" düğmesiyle aynı hedef).
  { label: "Excel'den içe aktar", href: "/app/ice-aktarma", icon: ICONS.iceAktarma, module: "customers" },
];

/** Ofisin kapattığı modüle ait adres mi? (Eylemler listesinden elenir; "Git" listesi menü süzgecini kullanır) */
function isClosedFeatureHref(href: string, closed: readonly string[]): boolean {
  if (closed.length === 0) return false;
  const key = featureForHref(href);
  return key !== null && closed.includes(key);
}

/**
 * "Eylemler" grubu: erişilebilen modüllerin hızlı oluşturma bağlantıları.
 * `locked`: pakete dahil olmayan sayfalar (yükseltme sayfasına düşmesin diye elenir).
 */
export function getAppActions(
  accessible: readonly AppModule[],
  q = "",
  locked: readonly string[] = [],
  closed: readonly string[] = [],
): PaletteEntry[] {
  return APP_ACTIONS.filter(
    (a) =>
      accessible.includes(a.module) &&
      !isClosedFeatureHref(a.href, closed) &&
      !locked.some((l) => a.href === l || a.href.startsWith(`${l}/`)) &&
      matchesQuery(a.label, q),
  ).map(({ label, href, icon, shortcut }) => ({ label, href, icon, shortcut }));
}
/**
 * "Git" grubu: nav-config'teki yetkili sayfalar (menüyle birebir aynı süzgeç). Arama etiket +
 * açıklama + eş anlamlılarda yapılır ("lead" → Talepler); sekmeler "Öğe · Sekme" adıyla listelenir
 * (Raporlar · Bölge), öğenin kendi sekmesi öğe adını ve `g` kısayolunu taşır.
 */
export function getAppGoItems(accessible: readonly AppModule[], q = "", closed: readonly string[] = []): PaletteEntry[] {
  return visibleSections(accessible, { closed })
    .flatMap((s) => s.items)
    .flatMap((i) => {
      if (!i.tabs || i.tabs.length <= 1) {
        return [{ label: i.label, href: i.href, icon: i.icon, description: i.description, keywords: i.keywords, shortcut: i.shortcut }];
      }
      return i.tabs.map((t) => {
        const own = t.href === i.href;
        return {
          label: own ? i.label : `${i.label} · ${t.label}`,
          href: t.href,
          icon: t.icon,
          description: own ? i.description : t.description,
          keywords: own ? i.keywords : t.keywords,
          shortcut: own ? i.shortcut : undefined,
        };
      });
    })
    .concat(
      // Menüde olmayan ama aranabilir sayfalar (ör. Bildirimler: üst çubuk zili).
      PALETTE_ONLY_PAGES.filter((p) => accessible.includes(p.module) && !isClosedFeatureHref(p.href, closed)).map((p) => ({
        label: p.label,
        href: p.href,
        icon: p.icon,
        description: p.description,
        keywords: p.keywords,
        shortcut: undefined,
      })),
    )
    .filter((e) => matchesQuery(navSearchText(e), q))
    .map(({ label, href, icon, description, shortcut }) => ({ label, href, icon, description, shortcut }));
}

/* ------------------------------ Niyet sözcük tablosu ------------------------------ */

/**
 * "Google kutusu" niyet tablosu: kullanıcı menü adını bilmeden günlük sözcükle yazar ("ata", "tv", "demo sil",
 * "kasa"), palet doğru sayfayı önerir. TEK kaynak burasıdır; eşleşme yoksa palet "AI Asistan'a sor" satırını gösterir.
 * Sözcükler aksan ve büyük/küçük harften bağımsız karşılaştırılır (`foldTr`): "danışman" = "danisman".
 * Yetki ve kapalı modül süzgeci menüyle aynıdır; yetkisiz/kapalı hedef önerilmez.
 */
type PaletteIntent = {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: NavIcon;
  /** `access`: sayfayı görebilmek yeter; `create`: oluşturma yetkisi gerekir (ör. yeni danışman). */
  needs: "access" | "create";
  module: AppModule;
  /** Tetikleyiciler: her biri bir sözcük dizisidir; dizinin TÜM sözcükleri sorguda geçmeli. */
  triggers: readonly (readonly string[])[];
};

export const PALETTE_INTENTS: readonly PaletteIntent[] = [
  {
    id: "havuz",
    label: "Havuz ve Atama",
    description: "Atanmamış ilanları danışmanlara dağıt",
    href: "/app/ilan-havuzu",
    icon: ICONS.ilanHavuzu,
    needs: "access",
    module: "properties",
    triggers: [["ata"], ["atama"], ["havuz"], ["ilan", "ata"], ["dagit"]],
  },
  {
    id: "tv",
    label: "TV modu",
    description: "Ofis panosunu büyük ekranda göster",
    href: "/app/pano-tv",
    icon: ICONS.panoTv,
    needs: "access",
    module: "reports",
    triggers: [["tv"], ["pano"], ["ekran"], ["televizyon"]],
  },
  {
    id: "gercek-kullanim",
    label: "Gerçek kullanıma geç",
    description: "Örnek (demo) verileri sil, kendi verinle başla",
    href: "/app/ayarlar/gercek-kullanim",
    icon: ICONS.ayar,
    needs: "access",
    module: "settings",
    triggers: [["demo", "sil"], ["demo"], ["gercek", "kullanim"], ["ornek", "veri"], ["verileri", "sil"]],
  },
  {
    id: "komisyonum",
    label: "Komisyonum",
    description: "Komisyon defteri, tahsilat ve kazanç",
    href: "/app/komisyon",
    icon: ICONS.komisyon,
    needs: "access",
    module: "commissions",
    triggers: [["komisyonum"], ["komisyon"], ["kazancim"], ["primim"], ["hakedis"]],
  },
  {
    id: "faturalar",
    label: "Faturalar",
    description: "Kestiğin ve aldığın faturalar (e-Fatura)",
    href: "/app/giderler?sekme=faturalar",
    icon: ICONS.gider,
    needs: "access",
    module: "expenses",
    triggers: [["fatura"], ["faturalar"], ["efatura"], ["e", "fatura"]],
  },
  {
    id: "finans",
    label: "Finans",
    description: "Gelir, gider, kasa ve banka hareketleri",
    href: "/app/giderler",
    icon: ICONS.gider,
    needs: "access",
    module: "expenses",
    triggers: [["kasa"], ["banka"], ["gelir"], ["gider"], ["masraf"], ["finans"], ["muhasebe"]],
  },
  {
    id: "yeni-danisman",
    label: "Yeni danışman ekle",
    description: "Ekibe yeni bir danışman davet et",
    href: "/app/ekip/yeni",
    icon: ICONS.ekip,
    needs: "create",
    module: "team",
    triggers: [["danisman", "ekle"], ["danisman", "yeni"], ["personel", "ekle"], ["calisan", "ekle"], ["ekip", "ekle"]],
  },
];

/** Aksan ve büyük/küçük harften bağımsız karşılaştırma için sadeleştirir ("Danışman" -> "danisman"). */
export function foldTr(input: string): string {
  return input
    .toLocaleLowerCase("tr-TR")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9\s]/g, " ");
}

/** Sorgu sözcüğü tetikleyici sözcükle eşleşir: eşit, ya da (≥3 harf) tetikleyicinin başı, ya da tetikleyici (≥4 harf) sorgunun başı. */
function wordMatches(token: string, trigger: string): boolean {
  if (token === trigger) return true;
  if (token.length >= 3 && trigger.startsWith(token)) return true;
  return trigger.length >= 4 && token.startsWith(trigger);
}

/**
 * Niyet önerileri: sorgudaki sözcükler bir niyetin tetikleyicisiyle eşleşirse hedef sayfa önerilir.
 * En az 2 karakter ister. `creatable` verilmezse erişilebilir modüller kullanılır.
 */
export function getAppIntents(
  accessible: readonly AppModule[],
  q: string,
  opts: { creatable?: readonly AppModule[]; locked?: readonly string[]; closed?: readonly string[] } = {},
): PaletteEntry[] {
  const tokens = foldTr(q).split(/\s+/).filter(Boolean);
  if (q.trim().length < 2 || tokens.length === 0) return [];
  const { creatable = accessible, locked = [], closed = [] } = opts;
  return PALETTE_INTENTS.filter((intent) => {
    const pool = intent.needs === "create" ? creatable : accessible;
    const path = intent.href.split("?")[0]!;
    if (!pool.includes(intent.module)) return false;
    if (isClosedFeatureHref(path, closed)) return false;
    if (locked.some((l) => path === l || path.startsWith(`${l}/`))) return false;
    return intent.triggers.some((words) => words.every((w) => tokens.some((t) => wordMatches(t, w))));
  }).map(({ label, href, icon, description }) => ({ label, href, icon, description }));
}

/**
 * Palete DIŞARIDAN erişim (ana ekrandaki "Ne yapmak istiyorsun?" kutusu vb.): `OPEN_PALETTE_EVENT` olayı.
 * `detail.q` verilirse palet bu başlangıç metniyle açılır ve arama hemen çalışır; verilmezse boş açılır.
 * Kullanım: `openPalette("havuz")` ya da elle
 * `window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT, { detail: { q: "havuz" } }))`.
 */
export type OpenPaletteDetail = { q?: string };

export function openPalette(q?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OpenPaletteDetail>(OPEN_PALETTE_EVENT, { detail: q ? { q } : {} }));
}

/** Olay gövdesinden başlangıç metni (olay düz `Event` ise ya da detail yoksa boş). */
export function paletteQueryFromEvent(e: Event): string {
  const detail = (e as CustomEvent<OpenPaletteDetail | undefined>).detail;
  return typeof detail?.q === "string" ? detail.q.slice(0, 200) : "";
}

/* ------------------------------ Görünüm komutları ------------------------------ */

/**
 * Komut paletinin "Görünüm" grubu: bir sayfaya GİTMEZ, tercihi anında uygular.
 * TEK kaynak burasıdır; seçenekler mevcut tablolardan üretilir (ACCENTS),
 * böylece yeni vurgu teması eklenince palet kendiliğinden güncellenir.
 * Kalıcılık MEVCUT mekanizmalardadır: tema/vurgu `lib/theme.ts` (localStorage + çerez),
 * sade görünüm `lib/ui-prefs.ts` (ofis+kullanıcı kapsamlı çerez). Yeni depolama yok.
 */
export type AppearanceAction =
  | { kind: "theme"; value: ThemePref }
  | { kind: "accent"; value: AccentPref }
  | { kind: "simple"; value: boolean };

export type AppearanceCommand = {
  /** Kararlı kimlik (liste anahtarı): "tema:dark", "vurgu:burgundy", "sade:on". */
  id: string;
  label: string;
  /** Etikette geçmeyen arama sözcükleri ("karanlık", "font" ...). */
  keywords: string;
  /** Uygulandıktan sonra gösterilen onay metni (toast; ekran okuyucuya da duyurulur). */
  done: string;
  action: AppearanceAction;
};

const THEME_COMMANDS: { value: ThemePref; label: string; keywords: string }[] = [
  { value: "light", label: "Açık", keywords: "görünüm aydınlık gündüz beyaz" },
  { value: "dark", label: "Koyu", keywords: "görünüm karanlık gece siyah" },
  { value: "system", label: "Sistem", keywords: "görünüm otomatik cihaz" },
];

export const APPEARANCE_COMMANDS: readonly AppearanceCommand[] = [
  ...THEME_COMMANDS.map((t) => ({
    id: `tema:${t.value}`,
    label: `Tema: ${t.label}`,
    keywords: t.keywords,
    done: `Tema: ${t.label} uygulandı`,
    action: { kind: "theme", value: t.value } as const,
  })),
  ...ACCENTS.map((a) => ({
    id: `vurgu:${a.value}`,
    label: `Vurgu rengi: ${a.label}`,
    keywords: `tema renk ${a.hint}`,
    done: `Vurgu rengi: ${a.label} uygulandı`,
    action: { kind: "accent", value: a.value } as const,
  })),
  {
    id: "sade:on",
    label: "Sade görünümü aç",
    keywords: "menü basit sık kullanılan",
    done: "Sade görünüm açıldı",
    action: { kind: "simple", value: true },
  },
  {
    id: "sade:off",
    label: "Sade görünümü kapat",
    keywords: "menü tüm sayfalar",
    done: "Sade görünüm kapatıldı",
    action: { kind: "simple", value: false },
  },
];

/** Paletin o anki tercihleri: işaretleme ("Seçili") ve uygun komutların süzülmesi için. */
export type AppearanceState = {
  theme?: ThemePref;
  accent?: AccentPref;
  /** Sade görünüm; çerez adı yoksa (ör. /admin) null: bu komutlar gösterilmez. */
  ui?: UiPrefs | null;
};

export type AppearanceEntry = AppearanceCommand & { current: boolean };

/** Sorgudaki HER sözcük etikette ya da anahtar sözcüklerde geçmeli ("koyu tema" = "Tema: Koyu"). */
export function matchesAllWords(haystack: string, q: string): boolean {
  const text = haystack.toLocaleLowerCase("tr-TR");
  return q
    .trim()
    .toLocaleLowerCase("tr-TR")
    .split(/\s+/)
    .every((word) => text.includes(word));
}

function isCurrent(action: AppearanceAction, state: AppearanceState): boolean {
  if (action.kind === "theme") return state.theme === action.value;
  if (action.kind === "accent") return state.accent === action.value;
  return false;
}

/**
 * Sorguya uyan görünüm komutları. En az 2 karakter ister (kayıt aramasıyla aynı eşik):
 * boş palette 16 satırlık bir liste açılmaz. "Sade görünüm" yalnız uygulanabilir yönüyle
 * (açıkken "kapat", kapalıyken "aç") listelenir.
 */
export function getAppearanceCommands(q: string, state: AppearanceState = {}): AppearanceEntry[] {
  if (q.trim().length < 2) return [];
  return APPEARANCE_COMMANDS.filter((c) => {
    const { action } = c;
    if (action.kind === "simple" && !state.ui) return false;
    if (action.kind === "simple" && state.ui && action.value === state.ui.simple) return false;
    return matchesAllWords(`${c.label} ${c.keywords}`, q);
  }).map((c) => ({ ...c, current: isCurrent(c.action, state) }));
}

/** Sade görünüm komutundan sonraki tercih; diğer komutlarda değişmez. */
export function nextUiPrefs(current: UiPrefs, action: AppearanceAction): UiPrefs {
  if (action.kind === "simple") return { ...current, simple: action.value };
  return current;
}

/**
 * Komutu uygular (yalnız tarayıcıda çağrılır). Tema ve vurgu anında geçerlidir
 * (ThemeController olayı dinler). Sade görünüm sunucuda uygulanır:
 * çerez yazılır ve `refresh: true` döner; çağıran `router.refresh()` yapar.
 * Çerez adı yoksa sade görünüm komutu uygulanmaz (`applied: false`).
 */
export function runAppearanceCommand(
  action: AppearanceAction,
  ui: { cookieName: string; current: UiPrefs } | null = null,
): { applied: boolean; refresh: boolean } {
  if (action.kind === "theme") {
    writeThemePref(action.value);
    return { applied: true, refresh: false };
  }
  if (action.kind === "accent") {
    writeAccentPref(action.value);
    return { applied: true, refresh: false };
  }
  if (!ui) return { applied: false, refresh: false };
  writeUiPrefsCookie(ui.cookieName, nextUiPrefs(ui.current, action));
  return { applied: true, refresh: true };
}

/* ------------------------------ Son görülenler ------------------------------ */

export type RecentItem = { label: string; href: string; kind: string };

const MAX_RECENTS = 8;
const NO_RECENTS: RecentItem[] = [];

/** Bozuk/yabancı localStorage içeriğini güvenle RecentItem listesine çevirir. */
export function parseRecents(raw: string | null): RecentItem[] {
  if (!raw) return NO_RECENTS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return NO_RECENTS;
    return parsed
      .filter(
        (x): x is RecentItem =>
          !!x &&
          typeof x === "object" &&
          typeof (x as RecentItem).label === "string" &&
          typeof (x as RecentItem).href === "string" &&
          /^\/app(\/|\?|$)/.test((x as RecentItem).href) &&
          typeof (x as RecentItem).kind === "string",
      )
      .slice(0, MAX_RECENTS);
  } catch {
    return NO_RECENTS;
  }
}

/** Yeni kaydı başa alır, aynı href'i tekrarlamaz, en fazla 8 tutar. */
export function mergeRecent(list: readonly RecentItem[], item: RecentItem): RecentItem[] {
  return [item, ...list.filter((r) => r.href !== item.href)].slice(0, MAX_RECENTS);
}

/**
 * useSyncExternalStore ile uyumlu küçük dış store (anahtar başına bir tane).
 * SSR'da boş liste döner; depolama kapalıysa yalnız oturum içi çalışır (try/catch).
 */
export function createRecentsStore(key: string) {
  let rawCache: string | null = null;
  let cache: RecentItem[] = NO_RECENTS;
  const listeners = new Set<() => void>();

  function read(): RecentItem[] {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return cache;
    }
    if (raw !== rawCache) {
      rawCache = raw;
      cache = parseRecents(raw);
    }
    return cache;
  }

  return {
    read,
    getServerSnapshot: (): RecentItem[] => NO_RECENTS,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    push(item: RecentItem) {
      const next = mergeRecent(read(), item);
      const raw = JSON.stringify(next);
      try {
        window.localStorage.setItem(key, raw);
      } catch {
        // depolama kapalı/dolu — yalnız oturum içi
      }
      rawCache = raw;
      cache = next;
      listeners.forEach((l) => l());
    },
  };
}
