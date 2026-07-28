/**
 * Belge Merkezi (/app/belgeler) — saf yardımcılar.
 *
 * Sunucu sayfası ve client liste bileşeni aynı etiketleri/rozetleri üretsin
 * diye tek kaynakta toplandı. Burada I/O yok; hem RSC hem "use client"
 * tarafından import edilebilir.
 */

import type { AppAction, AppModule } from "@/lib/permissions";

/** Belgenin geldiği kaynak tablo. URL'de `?kaynak=` değeri olarak da kullanılır. */
export const DOC_SOURCES = ["musteri", "portfoy", "sozlesme", "evrak"] as const;
export type DocSource = (typeof DOC_SOURCES)[number];

export function isDocSource(value: string | undefined | null): value is DocSource {
  return (DOC_SOURCES as readonly string[]).includes(value ?? "");
}

export const SOURCE_LABEL: Record<DocSource, string> = {
  musteri: "Müşteri dosyası",
  portfoy: "Portföy medyası",
  sozlesme: "Sözleşme",
  evrak: "Anlaşma evrağı",
};

/** Kaynak rozetinin renk sınıfı — mor yok (marka paleti: brand/mint/amber/ink). */
export const SOURCE_CHIP: Record<DocSource, string> = {
  musteri: "bg-brand-600/10 text-brand-600",
  portfoy: "bg-mint-500/12 text-mint-600",
  sozlesme: "bg-ink-950/8 text-ink-950",
  evrak: "bg-amber-400/15 text-amber-600",
};

/**
 * Kaynak → (modül, aksiyon) eşlemesi — belge merkezinin YETKİ SÖZLEŞMESİ.
 *
 * Birleşik liste tek ekranda dursa da yetki birleşmez: her satır geldiği
 * kaynağın kendi izniyle kapılıdır. `src/app/actions/documents.ts` bunu
 * çalıştırır, `/app/belgeler` aynı tabloya bakıp yapamayacağı işlemin
 * butonunu hiç çizmez (yetkisiz buton göstermek de bir yalandır).
 */
export const SOURCE_GATE: Record<DocSource, { mod: AppModule; action: AppAction }> = {
  musteri: { mod: "customers", action: "edit" },
  portfoy: { mod: "properties", action: "edit" },
  sozlesme: { mod: "contracts", action: "edit" },
  evrak: { mod: "commissions", action: "edit" },
};

/** Dosya uzantı grubu — `?tur=` kontratı. */
export const DOC_KINDS = ["gorsel", "pdf", "ofis", "diger"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export function isDocKind(value: string | undefined | null): value is DocKind {
  return (DOC_KINDS as readonly string[]).includes(value ?? "");
}

export const KIND_LABEL: Record<DocKind, string> = {
  gorsel: "Görsel",
  pdf: "PDF",
  ofis: "Ofis belgesi",
  diger: "Diğer",
};

const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp", "svg"];
const OFFICE_EXT = ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "odt", "ods"];

/** Dosya adının son uzantısı (küçük harf, noktasız). Yoksa boş dize. */
export function extOf(name: string | null | undefined): string {
  if (!name) return "";
  // URL ise sorgu dizesini at (…/tapu.pdf?token=… → pdf)
  const clean = name.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  if (dot < 0 || dot === clean.length - 1) return "";
  return clean.slice(dot + 1).toLowerCase();
}

/** MIME + dosya adından uzantı grubunu türetir. */
export function kindOf(mime: string | null | undefined, name: string | null | undefined): DocKind {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image/")) return "gorsel";
  if (m === "application/pdf") return "pdf";
  if (m.includes("word") || m.includes("excel") || m.includes("spreadsheet") || m.includes("presentation")) {
    return "ofis";
  }
  const ext = extOf(name);
  if (IMAGE_EXT.includes(ext)) return "gorsel";
  if (ext === "pdf") return "pdf";
  if (OFFICE_EXT.includes(ext)) return "ofis";
  return "diger";
}

/**
 * Anlamsal belge kategorisi — dosya adı/etiketinden çıkarılır.
 * Tahmindir; eşleşme yoksa "Diğer" der, uydurmaz.
 */
export type DocCategory = "kimlik" | "tapu" | "sozlesme" | "fotograf" | "diger";

export const CATEGORY_LABEL: Record<DocCategory, string> = {
  kimlik: "Kimlik",
  tapu: "Tapu",
  sozlesme: "Sözleşme",
  fotograf: "Fotoğraf",
  diger: "Diğer",
};

const CATEGORY_HINTS: Array<{ cat: DocCategory; words: string[] }> = [
  { cat: "kimlik", words: ["kimlik", "nufus", "nüfus", "tc", "pasaport", "ehliyet"] },
  { cat: "tapu", words: ["tapu", "iskan", "İskan", "imar", "kadastro", "dask", "abone"] },
  { cat: "sozlesme", words: ["sozlesme", "sözleşme", "kontrat", "vekalet", "vekâlet", "protokol", "taahhut", "taahhüt"] },
  { cat: "fotograf", words: ["foto", "fotoğraf", "gorsel", "görsel", "resim", "img", "photo"] },
];

export function categoryOf(
  source: DocSource,
  name: string | null | undefined,
  label: string | null | undefined,
  kind: DocKind,
): DocCategory {
  if (source === "sozlesme") return "sozlesme";
  const haystack = `${label ?? ""} ${name ?? ""}`.toLowerCase();
  for (const hint of CATEGORY_HINTS) {
    if (hint.words.some((w) => haystack.includes(w))) return hint.cat;
  }
  if (kind === "gorsel") return "fotograf";
  return "diger";
}

/** Byte → okunabilir Türkçe boyut. null/0 için "—". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(Number(bytes))) return "—";
  const n = Number(bytes);
  if (n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** Belge Merkezi listesindeki tek satır — dört kaynak da bu biçime indirgenir. */
export type DocumentRow = {
  /** `${kaynak}:${id}` — seçim/toplu işlem anahtarı. */
  key: string;
  source: DocSource;
  id: string;
  name: string;
  /** Kullanıcının verdiği etiket (customer_files.label) ya da evrak madde adı. */
  label: string | null;
  size: number | null;
  kind: DocKind;
  category: DocCategory;
  createdAt: string;
  uploaderName: string | null;
  /** İlişkili kayıt: "Ayşe Yılmaz" / "P-1042 · 3+1 Daire" */
  relatedLabel: string | null;
  /** İlişkili kaydın panel içi bağlantısı. */
  relatedHref: string | null;
  /** Görsel önizleme / indirme kaynağı; yoksa null (sözleşmede olduğu gibi). */
  previewUrl: string | null;
  downloadUrl: string | null;
  /** Silme/iptal bu satırda mümkün mü (kullanıcının kaynak izni). */
  canDelete: boolean;
};
