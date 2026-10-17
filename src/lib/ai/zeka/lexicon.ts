import type { AppModule } from "@/lib/permissions";
import { TERMS } from "@/lib/terms";
import type { ZekaEntity, ZekaStatus } from "./types";

/**
 * Zeka sözlüğü (SAF): varlıklar, Türkçe eş anlamlıları, durum ve niyet ipuçları. Tüm öğeler KATLANMIŞ biçimdedir
 * (`foldTr`: aksansız küçük harf) ve ön ek kuralıyla eşleşir (`matchesLexeme`). Ekranda görünen adlar ürün sözlüğünden
 * (`src/lib/terms.ts`, B193) gelir: ofisin kaydı "Portföy", satış süreci "Anlaşma", kişi "Müşteri", aranan ev "Talep".
 */

export type EntityDef = {
  id: ZekaEntity;
  /** Ekranda görünen ad (tekil). */
  label: string;
  /** Bu varlığı okumak için gereken izin modülü. */
  module: AppModule;
  /** Liste sayfası (gezinme hedefi). */
  listHref: string;
  /** Yeni kayıt formu (yoksa oluşturulamaz). `createModule` verilmezse `module` kullanılır. */
  createHref?: string;
  createModule?: AppModule;
  /** Katlanmış eş anlamlılar (tek ya da çok sözcüklü). */
  synonyms: readonly string[];
};

export const ENTITY_DEFS: readonly EntityDef[] = [
  {
    id: "customer",
    label: TERMS.customer,
    module: "customers",
    listHref: "/app/musteriler",
    createHref: "/app/musteriler/yeni",
    synonyms: ["musteri", "alici", "kisi", "mal sahibi", "malik", "satici", "aday", "lead"],
  },
  {
    id: "property",
    label: TERMS.property,
    module: "properties",
    listHref: "/app/portfoyler",
    createHref: "/app/portfoyler/yeni",
    synonyms: ["portfoy", "ilan", "daire", "konut", "villa", "arsa", "dukkan", "isyeri", "mulk", "residence", "rezidans", "mustakil", "tarla", "ev"],
  },
  {
    id: "demand",
    label: TERMS.demand,
    module: "demands",
    listHref: "/app/talepler",
    createHref: "/app/talepler/yeni",
    synonyms: ["talep", "taleb", "arayan", "arayis", "istek"],
  },
  {
    id: "appointment",
    label: "Randevu",
    module: "appointments",
    listHref: "/app/randevular",
    createHref: "/app/randevular/yeni",
    synonyms: ["randevu", "gosterim", "yer gosterme", "ziyaret", "bulusma"],
  },
  {
    id: "task",
    label: "Görev",
    module: "tasks",
    listHref: "/app/gorevler",
    createHref: "/app/gorevler/yeni",
    synonyms: ["gorev", "yapilacak", "hatirlat", "is listesi", "todo"],
  },
  {
    id: "deal",
    label: TERMS.deal,
    module: "commissions",
    listHref: "/app/anlasmalar",
    createHref: "/app/anlasmalar/yeni",
    synonyms: ["anlasma", "satis", "sattik", "satilan", "satmak", "kapanis", "firsat"],
  },
  {
    id: "offer",
    label: "Teklif",
    module: "offers",
    listHref: "/app/teklifler",
    createHref: "/app/teklifler/yeni",
    synonyms: ["teklif", "pazarlik"],
  },
  {
    id: "contract",
    label: "Sözleşme",
    module: "contracts",
    listHref: "/app/sozlesmeler",
    createHref: "/app/sozlesmeler/yeni",
    synonyms: ["sozlesme", "kontrat", "yetki belgesi"],
  },
  {
    id: "rental",
    label: "Kira",
    module: "rentals",
    listHref: "/app/kiralama",
    createHref: "/app/kiralama/yeni",
    synonyms: ["kira", "kiralama", "kiraci", "tahsilat", "depozito"],
  },
  {
    id: "dues",
    label: "Aidat",
    module: "expenses",
    listHref: "/app/finans",
    synonyms: ["aidat", "site yonetimi", "bina yonetimi"],
  },
  {
    id: "finance",
    label: "Gelir/Gider",
    module: "expenses",
    listHref: "/app/finans",
    synonyms: ["gelir", "gider", "masraf", "kasa", "muhasebe", "fatura", "harcama", "nakit"],
  },
  {
    id: "commission",
    label: "Komisyon",
    module: "commissions",
    listHref: "/app/finans",
    synonyms: ["komisyon", "hakedis", "kazanc", "prim", "ciro"],
  },
  {
    id: "campaign",
    label: "Kampanya",
    module: "campaigns",
    listHref: "/app/kampanyalar",
    createHref: "/app/kampanyalar/yeni",
    synonyms: ["kampanya", "toplu sms", "toplu mesaj", "bulten"],
  },
  {
    id: "team",
    label: "Ekip",
    module: "team",
    listHref: "/app/ekip",
    createHref: "/app/ekip/yeni",
    synonyms: ["ekip", "danisman", "personel", "calisan", "temsilci", "takim"],
  },
  {
    id: "report",
    label: "Rapor",
    module: "reports",
    listHref: "/app/raporlar",
    synonyms: ["rapor", "analiz", "istatistik", "grafik"],
  },
];

export const ENTITY_BY_ID: ReadonlyMap<ZekaEntity, EntityDef> = new Map(ENTITY_DEFS.map((e) => [e.id, e]));

/** Durum sözcükleri → durum. Sıra önemlidir (ilk eşleşen kazanır). */
export const STATUS_WORDS: readonly { status: ZekaStatus; words: readonly string[] }[] = [
  { status: "overdue", words: ["geciken", "gecikmis", "gecikme", "vadesi gecen", "vadesi gecmis", "odenmeyen", "odenmemis", "geride kalan"] },
  { status: "won", words: ["kazanilan", "kazandigimiz", "satilan", "sattik", "kapanan", "kapattik", "satis yaptik", "satis"] },
  { status: "lost", words: ["kaybedilen", "kaybettik", "iptal olan"] },
  { status: "done", words: ["tamamlanan", "biten", "bitmis", "yapilan", "tamamlanmis"] },
  { status: "upcoming", words: ["yaklasan", "gelecek", "bekleyen randevu"] },
  { status: "new", words: ["yeni gelen", "yeni"] },
  { status: "today", words: ["bugunku", "bugun"] },
  { status: "open", words: ["acik", "bekleyen", "suren", "aktif", "devam eden"] },
];

/** Soru/sayı ipuçları (veri sorusu). */
export const DATA_CUES: readonly string[] = [
  "kac", "kac tane", "ne kadar", "toplam", "sayisi", "adet", "en cok", "en fazla", "en iyi", "en az", "kim", "hangi danisman",
  "ortalama", "yuzde", "oran", "listele", "liste", "goster", "neler", "hangileri", "var mi",
];

/** "Nasıl yapılır" ipuçları. */
export const HOWTO_CUES: readonly string[] = [
  "nasil", "nedir", "ne demek", "ne ise yarar", "nerede", "nereden", "neden", "nicin", "yardim", "rehber", "ogret", "anlat",
  "mumkun mu", "yapabilir miyim", "edebilir miyim", "olur mu",
];

/** Oluşturma fiilleri. */
export const CREATE_CUES: readonly string[] = [
  "ekle", "olustur", "yeni", "kaydet", "kayit ac", "planla", "ayarla", "koy", "gir", "tanimla", "yaz", "hazirla", "hatirlat", "ac",
];

/** Gezinme fiilleri. */
export const NAV_CUES: readonly string[] = ["git", "sayfa", "sayfasi", "ekran", "ekrani", "menu", "goster", "ac", "bolum"];

/** Rapor ipuçları. */
export const REPORT_CUES: readonly string[] = ["rapor", "raporu", "performans", "ozet", "karne", "analiz", "istatistik"];

/** Konuşma dolgu sözcükleri (serbest metinden atılır). */
export const NOISE_WORDS: ReadonlySet<string> = new Set([
  "bir", "bu", "su", "o", "ve", "ile", "icin", "mi", "mu", "misin", "musun", "lutfen", "bana", "benim", "bizim", "bize", "biz",
  "ben", "var", "yok", "olan", "olarak", "gibi", "da", "de", "ki", "ne", "hangi", "tum", "butun", "hepsi", "simdi", "acaba",
  "yap", "yapar", "yaptik", "yaptim", "kac", "tane", "adet", "goster", "listele", "bul", "ara", "getir", "olan", "arasi",
  "alti", "ustu", "kadar", "en", "cok", "fazla", "az", "saat", "gun", "hafta", "ay", "yil", "bugun", "yarin", "dun",
]);
