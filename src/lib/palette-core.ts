import { earningsPath, financePath } from "@/lib/finance/routes";
import { ICONS } from "@/lib/icons";
import { isHrefLocked } from "@/lib/billing/locked-href";
import { featureForHref } from "@/lib/modules/route-table";
import { NAV_PAGE_LABELS, navSearchText, PALETTE_ONLY_PAGES, visibleSections, type NavIcon } from "@/lib/nav-config";
import type { AppModule } from "@/lib/permissions";
import { ACCENTS, writeAccentPref, writeThemePref, type AccentPref, type ThemePref } from "@/lib/theme";
import { matchesQuery } from "@/lib/palette-events";

// Bağımlılıksız yardımcılar ayrı modülde (admin paleti / hızlı erişim ICONS + nav-config taşımasın diye); eski yol çalışsın.
export {
  OPEN_PALETTE_EVENT,
  matchesQuery,
  openPalette,
  paletteQueryFromEvent,
  parseRecents,
  mergeRecent,
  createRecentsStore,
  type OpenPaletteDetail,
  type RecentItem,
} from "@/lib/palette-events";

/**
 * Komut paletleri (/app ve /admin) için ortak mantık: arama süzgeci, yetkiye göre
 * "Git" / "Eylemler" listeleri, "Görünüm" komutları (tema, vurgu rengi, sade görünüm;
 * yazı boyutu Kaydet gerektirdiği için menüdeki Görünüm panelindedir) ve localStorage destekli "Son görülenler" deposu.
 * İki palet farklı arama kaynaklarına sahip olduğundan görünüm ayrı kalır;
 * veri ve davranış burada tek yerdedir.
 */

/** Komut paleti "Ayarlar" grubu: ayar arama sonuçlarının grup adı (sonuçlar sunucudan, registry indeksinden ve rol filtreli gelir). */
export const PALETTE_SETTINGS_GROUP = "Ayarlar";


export type PaletteEntry = {
  label: string;
  href: string;
  icon: NavIcon;
  /** Klavye kısayolu ("n m", "g p"); palet satırında rozet olarak gösterilir. */
  shortcut?: string;
  /** Satırın altında görünen tek cümle (nav-config `description`). */
  description?: string;
};


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
  { label: "Sahibinden ilan ekle", href: "/app/portfoy-avi/yeni", icon: ICONS.mulkSahibi, module: "prospecting" },
  { label: "Yeni randevu", href: "/app/randevular/yeni", icon: ICONS.randevu, module: "appointments", shortcut: "n r" },
  { label: "Yeni görev", href: "/app/gorevler/yeni", icon: ICONS.gorev, module: "tasks", shortcut: "n g" },
  { label: "Yeni anlaşma", href: "/app/anlasmalar/yeni", icon: ICONS.anlasma, module: "commissions", shortcut: "n a" },
  { label: "Yeni teklif", href: "/app/teklifler/yeni", icon: ICONS.teklif, module: "offers" },
  { label: "Yeni sözleşme", href: "/app/sozlesmeler/yeni", icon: ICONS.sozlesme, module: "contracts" },
  // Muhasebe kaydı: tam sayfa kayıt çalışma alanı (gider/gelir/transfer/belge/toplu; expenses izni).
  { label: "Gelir/Gider kaydı", href: financePath("kayit"), icon: ICONS.gider, module: "expenses" },
  { label: "Yeni kiralama", href: "/app/kiralama/yeni", icon: ICONS.anahtar, module: "rentals" },
  { label: "Yeni proje", href: "/app/projeler/yeni", icon: ICONS.proje, module: "projects" },
  { label: "Yeni açık ev", href: "/app/acik-ev/yeni", icon: ICONS.acikEv, module: "open_house" },
  { label: "Yeni sunum", href: "/app/portfoyler/sunumlar/yeni", icon: ICONS.sunum, module: "properties" },
  { label: "Yeni kampanya", href: "/app/kampanyalar/yeni", icon: ICONS.mesaj, module: "campaigns" },
  { label: "Yeni onay talebi", href: "/app/onaylar/yeni", icon: ICONS.onay, module: "commissions" },
  { label: "Yeni otomasyon", href: "/app/otomasyonlar/yeni", icon: ICONS.otomasyon, module: "settings" },
  { label: "Yeni takip dizisi", href: "/app/otomasyonlar/diziler/yeni", icon: ICONS.otomasyon, module: "settings" },
  { label: "Yeni danışman", href: "/app/ekip/yeni", icon: ICONS.ekip, module: "team" },
  { label: "Yeni destek talebi", href: "/app/destek/yeni", icon: ICONS.destek, module: "support" },
  { label: "Görüşme kaydet", href: "/app/gelen-kutusu?sekme=cagri", icon: ICONS.telefon, module: "calls" },
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
      !isHrefLocked(a.href, locked) &&
      matchesQuery(a.label, q),
  ).map(({ label, href, icon, shortcut }) => ({ label, href, icon, shortcut }));
}
/**
 * "Git" grubu: nav-config'teki yetkili sayfalar (menüyle birebir aynı süzgeç). Ad menüdeki GÖRÜNEN addır
 * (`NAV_PAGE_LABELS`, nav-roles tek kaynak: "Bugün", "Ekip", "Yetkiler", "Destek"); menüde olmayan sekme "Öğe · Sekme"
 * adıyla listelenir. Arama ad + açıklama + eş anlamlılarda yapılır ("lead" → Talepler); öğenin kendi sekmesi `g` kısayolunu taşır.
 */
export function getAppGoItems(accessible: readonly AppModule[], q = "", closed: readonly string[] = []): PaletteEntry[] {
  return visibleSections(accessible, { closed })
    .flatMap((s) => s.items)
    .flatMap((i) => {
      if (!i.tabs || i.tabs.length <= 1) {
        return [{ label: NAV_PAGE_LABELS.get(i.href) ?? i.label, href: i.href, icon: i.icon, description: i.description, keywords: i.keywords, shortcut: i.shortcut }];
      }
      return i.tabs.map((t) => {
        const own = t.href === i.href;
        return {
          label: NAV_PAGE_LABELS.get(t.href) ?? (own ? i.label : `${i.label} · ${t.label}`),
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
        label: NAV_PAGE_LABELS.get(p.href) ?? p.label,
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
  // ── Eylem fiilleri (B058): kullanıcı "müşteri ekle", "ilan paylaş" gibi günlük fiille yazar ────────────────
  {
    id: "yeni-musteri",
    label: "Yeni müşteri ekle",
    description: "Müşteri kaydı aç (aynı telefon ofiste varsa uyarır)",
    href: "/app/musteriler/yeni",
    icon: ICONS.musteri,
    needs: "create",
    module: "customers",
    triggers: [["musteri", "ekle"], ["musteri", "olustur"], ["musteri", "kaydet"], ["yeni", "musteri"], ["kisi", "ekle"], ["alici", "ekle"]],
  },
  {
    id: "yeni-portfoy",
    label: "Yeni portföy ekle",
    description: "İlan/portföy kaydı aç",
    href: "/app/portfoyler/yeni",
    icon: ICONS.portfoy,
    needs: "create",
    module: "properties",
    triggers: [["portfoy", "ekle"], ["ilan", "ekle"], ["ilan", "gir"], ["yeni", "portfoy"], ["yeni", "ilan"], ["portfoy", "olustur"]],
  },
  {
    id: "yeni-talep",
    label: "Yeni talep ekle",
    description: "Müşterinin aradığı evi kaydet",
    href: "/app/talepler/yeni",
    icon: ICONS.talep,
    needs: "create",
    module: "demands",
    triggers: [["talep", "ekle"], ["talep", "olustur"], ["yeni", "talep"], ["arayis", "ekle"]],
  },
  {
    id: "yeni-randevu",
    label: "Randevu ver",
    description: "Yer gösterme ya da görüşme randevusu planla",
    href: "/app/randevular/yeni",
    icon: ICONS.randevu,
    needs: "create",
    module: "appointments",
    triggers: [["randevu", "ekle"], ["randevu", "ver"], ["randevu", "olustur"], ["yeni", "randevu"], ["randevu"]],
  },
  {
    id: "ilan-paylas",
    label: "İlan paylaş (sunum hazırla)",
    description: "Portföyü müşteriye özel sunum bağlantısıyla gönder",
    href: "/app/portfoyler/sunumlar/yeni",
    icon: ICONS.sunum,
    needs: "create",
    module: "properties",
    triggers: [["ilan", "paylas"], ["portfoy", "paylas"], ["paylas"], ["sunum"]],
  },
  {
    id: "bugun-ozet",
    label: "Bugün",
    description: "Bugün ne oldu: yeni kayıtlar, randevular, dikkat gerektirenler",
    href: "/app",
    icon: ICONS.dashboard,
    needs: "access",
    module: "dashboard",
    triggers: [["bugun"], ["ne", "oldu"], ["gunun", "ozeti"]],
  },
  {
    id: "gider-ekle",
    label: "Gelir/gider kaydı",
    description: "Masraf ya da gelir kaydı gir",
    href: financePath(),
    icon: ICONS.gider,
    needs: "create",
    module: "expenses",
    triggers: [["gider", "ekle"], ["masraf", "ekle"], ["gelir", "ekle"], ["masraf", "gir"]],
  },
  {
    id: "tahsilat",
    label: "Komisyon tahsilatı",
    description: "Komisyon defteri, tahsil edilen ve bekleyen",
    href: financePath("komisyon"),
    icon: ICONS.komisyon,
    needs: "access",
    module: "commissions",
    triggers: [["tahsilat"], ["tahsil"], ["alacak"]],
  },
  {
    id: "arama-kaydi",
    label: "Görüşme kaydet",
    description: "Gelen/giden aramayı ve sonucunu kaydet",
    href: "/app/gelen-kutusu?sekme=cagri",
    icon: ICONS.telefon,
    needs: "access",
    module: "calls",
    triggers: [["arama"], ["cagri"], ["gorusme", "kaydet"], ["arayan"]],
  },
  {
    id: "ciro",
    label: "Ciro ve satış raporu",
    description: "Bu ayın cirosu, kapanan satışlar ve komisyon",
    href: "/app/raporlar",
    icon: ICONS.rapor,
    needs: "access",
    module: "reports",
    triggers: [["ciro"], ["bu", "ay"], ["satis", "raporu"]],
  },
  {
    id: "portala-aktar",
    label: "Portal ilanları",
    description: "İlanların portallardaki durumu, aktarım ve teyit",
    href: "/app/ilan-kontrol",
    icon: ICONS.ilanKontrol,
    needs: "access",
    module: "portals",
    triggers: [["portala", "aktar"], ["portal", "aktar"], ["portal"], ["sahibinden"]],
  },
  {
    id: "havuz",
    label: "Portföy dağıtımı",
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
    href: financePath("komisyon"),
    icon: ICONS.komisyon,
    needs: "access",
    module: "commissions",
    triggers: [["komisyonum"], ["komisyon"], ["kazancim"], ["primim"], ["hakedis"]],
  },
  {
    id: "faturalar",
    label: "Faturalar",
    description: "Kestiğin ve aldığın faturalar (e-Fatura)",
    href: financePath("faturalar"),
    icon: ICONS.gider,
    needs: "access",
    module: "expenses",
    triggers: [["fatura"], ["faturalar"], ["efatura"], ["e", "fatura"]],
  },
  {
    id: "duzenli",
    label: "Düzenli ödemeler",
    description: "Kira, maaş, üyelik gibi otomatik aylık ödemeler",
    href: financePath("tekrarlayan"),
    icon: ICONS.gider,
    needs: "access",
    module: "expenses",
    triggers: [["duzenli", "odeme"], ["otomatik", "odeme"], ["kira", "odemesi"], ["tekrarlayan"]],
  },
  {
    id: "kasam",
    label: "Kasam",
    description: "Kendi kasan, bankan ve kişisel gelir-giderin",
    href: earningsPath("kasam"),
    icon: ICONS.gider,
    needs: "access",
    module: "dashboard",
    triggers: [["kasam"], ["benim", "kasam"], ["kisisel", "hesap"], ["kisisel", "gelir"]],
  },
  {
    id: "finans",
    label: "Finans",
    description: "Gelir, gider, kasa ve banka hareketleri",
    href: financePath(),
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
  const rows: PaletteEntry[] = PALETTE_INTENTS.filter((intent) => {
    const pool = intent.needs === "create" ? creatable : accessible;
    const path = intent.href.split("?")[0]!;
    if (!pool.includes(intent.module)) return false;
    if (isClosedFeatureHref(path, closed)) return false;
    if (isHrefLocked(path, locked)) return false;
    return intent.triggers.some((words) => words.every((w) => tokens.some((t) => wordMatches(t, w))));
  }).map(({ label, href, icon, description }) => ({ label, href, icon, description }));
  // Yardım indeksi (B058): "nasıl …", "… nedir", "yardım" → Yardım merkezinde bu metinle arama (rehber + SSS + sözlük).
  if (accessible.includes("support") && !isClosedFeatureHref("/app/yardim", closed) && tokens.some((t) => HELP_WORDS.has(t))) {
    rows.push({
      label: `Yardımda ara: "${q.trim()}"`,
      href: `/app/yardim?q=${encodeURIComponent(q.trim())}`,
      icon: ICONS.destek,
      description: "Rehberler, sık sorulanlar ve sözlük",
    });
  }
  return rows;
}

const HELP_WORDS = new Set(["nasil", "nedir", "neden", "yardim", "rehber"]);

/**
 * Paletin arama modundaki SAYFA satırları (panel ile sözleşme testi AYNI işlevi kullanır): önce niyet tablosu, sonra
 * eşleşen eylemler ve "Git" sayfaları; tekilleştirilmiş, en çok 6. Ana ekran çiplerinin her rolde en az bir sonuç
 * vermesi bununla doğrulanır.
 */
export function getPaletteRows(
  q: string,
  opts: { accessible: readonly AppModule[]; creatable?: readonly AppModule[]; locked?: readonly string[]; closed?: readonly string[] },
): PaletteEntry[] {
  if (q.trim().length < 2) return [];
  const creatable = opts.creatable ?? opts.accessible;
  const locked = opts.locked ?? [];
  const closed = opts.closed ?? [];
  const intents = getAppIntents(opts.accessible, q, { creatable, locked, closed });
  const actions = getAppActions(creatable, q, locked, closed);
  const goItems = getAppGoItems(opts.accessible, q, closed);
  const seen = new Set<string>();
  return [...intents, ...actions, ...goItems].filter((e) => (seen.has(e.href) ? false : (seen.add(e.href), true))).slice(0, 6);
}


/* ------------------------------ Görünüm komutları ------------------------------ */

/**
 * Komut paletinin "Görünüm" grubu: bir sayfaya GİTMEZ, tercihi anında uygular.
 * TEK kaynak burasıdır; seçenekler mevcut tablolardan üretilir (ACCENTS),
 * böylece yeni vurgu teması eklenince palet kendiliğinden güncellenir.
 * Kalıcılık MEVCUT mekanizmadadır: tema/vurgu `lib/theme.ts` (localStorage + çerez). Yeni depolama yok.
 */
export type AppearanceAction =
  | { kind: "theme"; value: ThemePref }
  | { kind: "accent"; value: AccentPref };

export type AppearanceCommand = {
  /** Kararlı kimlik (liste anahtarı): "tema:dark", "vurgu:burgundy". */
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
];

/** Paletin o anki tercihleri: işaretleme ("Seçili") ve uygun komutların süzülmesi için. */
export type AppearanceState = {
  theme?: ThemePref;
  accent?: AccentPref;
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
  return state.accent === action.value;
}

/**
 * Sorguya uyan görünüm komutları. En az 2 karakter ister (kayıt aramasıyla aynı eşik):
 * boş palette 16 satırlık bir liste açılmaz.
 */
export function getAppearanceCommands(q: string, state: AppearanceState = {}): AppearanceEntry[] {
  if (q.trim().length < 2) return [];
  return APPEARANCE_COMMANDS.filter((c) => matchesAllWords(`${c.label} ${c.keywords}`, q)).map((c) => ({ ...c, current: isCurrent(c.action, state) }));
}

/** Komutu uygular (yalnız tarayıcıda çağrılır). Tema ve vurgu anında geçerlidir (ThemeController olayı dinler). */
export function runAppearanceCommand(action: AppearanceAction): { applied: boolean; refresh: boolean } {
  if (action.kind === "theme") writeThemePref(action.value);
  else writeAccentPref(action.value);
  return { applied: true, refresh: false };
}
