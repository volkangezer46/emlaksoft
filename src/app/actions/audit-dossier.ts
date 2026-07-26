"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { COMMISSION_CAP_PCT } from "@/lib/contract-risk";

/**
 * Denetim dosyası (X10).
 *
 * ============================================================================
 * NEDEN VAR
 * ============================================================================
 * Taşınmaz Ticareti Yönetmeliği kapsamında bir emlak ofisi denetlendiğinde
 * yetki belgeleri, sözleşmeler, hizmet bedeli kayıtları ve İYS rızaları
 * istenir. Bu veriler sistemde VAR ama beş ayrı sayfaya dağılmış; denetim
 * anında tek tek toplamak gerekiyordu.
 *
 * ============================================================================
 * NEDEN ZIP DEĞİL
 * ============================================================================
 * ZIP üretmek `archiver`/`jszip` gibi bir bağımlılık ister ve asıl değerin
 * küçük bir kısmını verir: denetmen zaten evrakı EKRANDA ya da KAĞITTA görmek
 * istiyor, arşiv dosyası olarak değil.
 *
 * Bunun yerine tek sayfalık yazdırılabilir bir dosya üretiliyor —
 * `globals.css` içindeki `@media print` katmanı zaten hazır. Tarayıcının
 * "PDF olarak kaydet" akışı seçilebilir metinli, tek dosyalık bir çıktı
 * veriyor. Satır bazlı döküm gerekirse mevcut CSV dışa aktarımları duruyor.
 *
 * ============================================================================
 * DÜRÜSTLÜK
 * ============================================================================
 * Dosya EKSİKLERİ de gösteriyor: yetki belgesi olmayan portföy, süresi geçmiş
 * yetki, rızası olmayan müşteri. Yalnızca iyi tarafı gösteren bir denetim
 * dosyası denetime hazırlık değil, kendini kandırmadır.
 */

export type DossierAyar = {
  /** Kapsam başlangıcı (ISO tarih). Boşsa son 12 ay. */
  from?: string | null;
  to?: string | null;
};

export type Dossier = {
  ofis: {
    name: string;
    license_no: string | null;
    tax_office: string | null;
    tax_number: string | null;
    address_line: string | null;
    phone: string | null;
  } | null;
  donem: { from: string; to: string };
  /** Yetki belgesi durumu. */
  yetki: {
    toplam: number;
    belgeli: number;
    belgesiz: number;
    suresiGecmis: number;
    yakinda: number;
  };
  sozlesme: { toplam: number; imzali: number; taslak: number; iptal: number };
  hizmetBedeli: {
    kayitSayisi: number;
    brutToplam: number;
    kdvToplam: number;
    sinirUstuPortfoy: number;
  };
  iys: { toplam: number; izinli: number; izinsiz: number; rizasizMusteri: number };
  kvkk: { silmeTalebi: number };
  denetimIzi: { kayitSayisi: number; ilk: string | null; son: string | null };
  /** Denetmenin sorabileceği somut eksikler. */
  eksikler: { baslik: string; adet: number; aciklama: string }[];
};

function iso(d: Date) {
  return d.toISOString();
}

export async function buildAuditDossier(ayar: DossierAyar = {}): Promise<Dossier | null> {
  const gate = await requirePermission("compliance", "view");
  if (!gate.ok) return null;

  const supabase = await createClient();
  const simdi = new Date();
  const from = ayar.from ?? iso(new Date(simdi.getTime() - 365 * 86_400_000));
  const to = ayar.to ?? iso(simdi);
  const bugun = simdi.toISOString().slice(0, 10);
  const onbesGun = new Date(simdi.getTime() + 15 * 86_400_000).toISOString().slice(0, 10);

  /*
   * Hepsi `head: true` + `count`: satır çekilmiyor, yalnızca sayılar. Denetim
   * dosyası bir ÖZET; satır bazlı döküm için mevcut CSV dışa aktarımları var.
   */
  const [
    { data: ofis },
    { count: portfoyToplam },
    { count: belgeli },
    { count: suresiGecmis },
    { count: yakinda },
    { count: sozlesmeToplam },
    { count: imzali },
    { count: taslak },
    { count: iptal },
    { data: komisyonlar },
    { count: sinirUstu },
    { count: iysToplam },
    { count: iysIzinli },
    { count: musteriToplam },
    { count: kvkkSilme },
    { count: denetimKayit },
    { data: denetimIlk },
    { data: denetimSon },
  ] = await Promise.all([
    supabase
      .from("tenants")
      .select("name, license_no, tax_office, tax_number, address_line, phone")
      .eq("id", gate.tenantId)
      .maybeSingle(),
    supabase.from("properties").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .not("authorization_end", "is", null),
    supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .not("authorization_end", "is", null)
      .lt("authorization_end", bugun),
    supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .gte("authorization_end", bugun)
      .lte("authorization_end", onbesGun),
    supabase.from("contracts").select("id", { count: "exact", head: true }).gte("created_at", from).lte("created_at", to),
    supabase
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("status", "signed")
      .gte("created_at", from)
      .lte("created_at", to),
    supabase
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft")
      .gte("created_at", from)
      .lte("created_at", to),
    supabase
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("status", "cancelled")
      .gte("created_at", from)
      .lte("created_at", to),
    supabase
      .from("commissions")
      .select("gross_amount, vat_amount")
      .gte("created_at", from)
      .lte("created_at", to)
      .limit(2000),
    /*
     * Hizmet bedeli üst sınırı. `contract-risk.ts` ile AYNI sabit kullanılıyor —
     * iki yerde iki farklı eşik olması denetim dosyasını çelişkili yapardı.
     */
    supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .gt("commission_rate", COMMISSION_CAP_PCT),
    supabase.from("iys_consents").select("id", { count: "exact", head: true }),
    supabase.from("iys_consents").select("id", { count: "exact", head: true }).eq("status", "granted"),
    supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("kvkk_erasure_log").select("id", { count: "exact", head: true }),
    supabase.from("audit_logs").select("id", { count: "exact", head: true }),
    supabase.from("audit_logs").select("created_at").order("created_at", { ascending: true }).limit(1),
    supabase.from("audit_logs").select("created_at").order("created_at", { ascending: false }).limit(1),
  ]);

  /*
   * Rızası olan MÜŞTERİ sayısı, rıza SATIRI sayısı DEĞİL: bir müşterinin dört
   * kanalda (sms/email/whatsapp/call) ayrı rızası olabilir. `count` satır
   * sayar; ayrımı yapmazsak "rızasız müşteri" NEGATİF çıkar.
   *
   * PostgREST `count(distinct …)` yapamıyor, bu yüzden satırları çekip Set ile
   * sayıyoruz. 5000 sınırı var ve aşılırsa sayı eksik kalır — bu ölçekte bir
   * ofis için gerçekçi değil, ama sessiz bir hata olmasın diye not düşüldü.
   */
  const { data: rizaSatirlari } = await supabase
    .from("iys_consents")
    .select("customer_id")
    .eq("status", "granted")
    .limit(5000);
  const rizaliBenzersiz = new Set((rizaSatirlari ?? []).map((r) => r.customer_id).filter(Boolean)).size;

  const brutToplam = (komisyonlar ?? []).reduce((s, c) => s + Number(c.gross_amount ?? 0), 0);
  const kdvToplam = (komisyonlar ?? []).reduce((s, c) => s + Number(c.vat_amount ?? 0), 0);

  const toplam = portfoyToplam ?? 0;
  const belgeliSayi = belgeli ?? 0;
  const belgesiz = Math.max(0, toplam - belgeliSayi);
  const rizasiz = Math.max(0, (musteriToplam ?? 0) - rizaliBenzersiz);

  /*
   * EKSİKLER — denetim dosyasının en değerli kısmı. Yalnızca iyi tarafı
   * gösteren bir dosya denetime hazırlık değil, kendini kandırmadır.
   */
  const eksikler: Dossier["eksikler"] = [];
  if (belgesiz > 0) {
    eksikler.push({
      baslik: "Yetki belgesi tarihi girilmemiş portföy",
      adet: belgesiz,
      aciklama: "Yazılı yetki olmadan aracılık mevzuata aykırı. Belge tarihlerini portföy kaydına girin.",
    });
  }
  if ((suresiGecmis ?? 0) > 0) {
    eksikler.push({
      baslik: "Yetki süresi geçmiş portföy",
      adet: suresiGecmis ?? 0,
      aciklama: "Süresi dolmuş yetkiyle işlem yapılamaz. Yenileyin ya da portföyü arşivleyin.",
    });
  }
  if ((sinirUstu ?? 0) > 0) {
    eksikler.push({
      baslik: `Komisyon oranı %${COMMISSION_CAP_PCT} üstünde portföy`,
      adet: sinirUstu ?? 0,
      aciklama:
        "Yönetmelik hizmet bedeline üst sınır getiriyor. Bu bir hukuki tespit değil; oranı ve sözleşme türünü teyit edin.",
    });
  }
  if (rizasiz > 0) {
    eksikler.push({
      baslik: "İYS rızası kayıtlı olmayan müşteri",
      adet: rizasiz,
      aciklama: "Ticari elektronik ileti göndermeden önce rıza kaydı şart. Uyum merkezinden ekleyin.",
    });
  }
  if ((taslak ?? 0) > 0) {
    eksikler.push({
      baslik: "Taslakta kalmış sözleşme",
      adet: taslak ?? 0,
      aciklama: "İmza sürecine girmemiş sözleşmeler. Tamamlayın ya da iptal edin.",
    });
  }

  return {
    ofis: ofis ?? null,
    donem: { from, to },
    yetki: {
      toplam,
      belgeli: belgeliSayi,
      belgesiz,
      suresiGecmis: suresiGecmis ?? 0,
      yakinda: yakinda ?? 0,
    },
    sozlesme: {
      toplam: sozlesmeToplam ?? 0,
      imzali: imzali ?? 0,
      taslak: taslak ?? 0,
      iptal: iptal ?? 0,
    },
    hizmetBedeli: {
      kayitSayisi: (komisyonlar ?? []).length,
      brutToplam,
      kdvToplam,
      sinirUstuPortfoy: sinirUstu ?? 0,
    },
    iys: {
      toplam: iysToplam ?? 0,
      izinli: iysIzinli ?? 0,
      izinsiz: Math.max(0, (iysToplam ?? 0) - (iysIzinli ?? 0)),
      rizasizMusteri: rizasiz,
    },
    kvkk: { silmeTalebi: kvkkSilme ?? 0 },
    denetimIzi: {
      kayitSayisi: denetimKayit ?? 0,
      ilk: denetimIlk?.[0]?.created_at ?? null,
      son: denetimSon?.[0]?.created_at ?? null,
    },
    eksikler,
  };
}
