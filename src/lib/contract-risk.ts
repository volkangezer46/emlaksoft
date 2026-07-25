/**
 * Sözleşme risk taraması (X4).
 *
 * NE YAPAR: Sözleşme metnini ve kaydını MEKANİK olarak denetler — doldurulmamış
 * boşluk, eksik madde başlığı, tarih tutarsızlığı, imzacı eksikliği.
 *
 * NE YAPMAZ — ÖNEMLİ: Hukuki görüş vermez. Bir maddenin varlığını arar, o
 * maddenin İÇERİĞİNİN doğru ya da yeterli olduğunu söyleyemez. Sonuçlar
 * "gönder tuşuna basmadan önce bak" listesidir, avukat onayı değildir.
 * Arayüzde bu açıkça yazılı.
 *
 * NEDEN GEREKLİ: Sözleşme şablonları `___________` yer tutucularıyla geliyor
 * (`new-contract-dialog.tsx` içindeki TEMPLATES). Doldurulmamış bir şablonu
 * imzaya göndermek sahada en sık yapılan hata ve hiçbir kontrol yoktu —
 * `createContract` yalnızca başlık ve gövdenin boş olmadığına bakıyordu.
 */

export type RiskLevel = "error" | "warning" | "info";

export type ContractRisk = {
  level: RiskLevel;
  code: string;
  title: string;
  detail: string;
};

export type ContractInput = {
  contractType: string;
  title: string | null;
  body: string | null;
  status: string;
  signedAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  signerCount: number;
  hasProperty: boolean;
  hasCustomer: boolean;
  /** Portföydeki komisyon oranı (%) — varsa mevzuat sınırıyla karşılaştırılır. */
  commissionRate?: number | null;
};

/**
 * Türüne göre metinde ARANAN madde anahtar kelimeleri.
 *
 * Yalnızca VARLIK aranıyor: "depozito" kelimesi geçiyor mu? İçeriğinin doğru
 * olup olmadığı bu tarayıcının işi değil.
 */
const EXPECTED_CLAUSES: Record<string, { key: string; label: string }[]> = {
  satis: [
    { key: "bedel", label: "Satış bedeli" },
    { key: "ödeme", label: "Ödeme planı" },
    { key: "tapu", label: "Tapu devri" },
  ],
  kira: [
    { key: "kira bedel", label: "Kira bedeli" },
    { key: "depozito", label: "Depozito" },
    { key: "süre", label: "Kira süresi" },
    { key: "artış", label: "Kira artış maddesi" },
  ],
  sozlesme: [
    { key: "hizmet bedel", label: "Hizmet bedeli" },
    { key: "süre", label: "Sözleşme süresi" },
  ],
};

/**
 * Taşınmaz Ticareti Yönetmeliği'nde hizmet bedeli için üst sınır tanımlı.
 * Bu sayı BİLGİ AMAÇLI bir eşik: aşıldığında uyarı verilir, işlem
 * engellenmez. Mevzuat değişebilir; uyarı metni kullanıcıyı teyide
 * yönlendiriyor, kesin hüküm kurmuyor.
 */
export const COMMISSION_CAP_PCT = 4;

/** Şablonlardaki yer tutucu: üç ya da daha fazla alt çizgi. */
const PLACEHOLDER = /_{3,}/g;

function gunFarki(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
}

function gecerliTarih(v: string | null): boolean {
  return Boolean(v) && !Number.isNaN(new Date(v as string).getTime());
}

export function scanContract(input: ContractInput, now: Date = new Date()): ContractRisk[] {
  const riskler: ContractRisk[] = [];
  const body = input.body ?? "";
  const imzalandi = input.status === "signed" || Boolean(input.signedAt);
  const taslak = input.status === "draft";

  // --- 1) Doldurulmamış yer tutucular ---
  const bosluklar = body.match(PLACEHOLDER)?.length ?? 0;
  if (bosluklar > 0) {
    riskler.push({
      level: imzalandi || !taslak ? "error" : "warning",
      code: "blank_placeholder",
      title: `${bosluklar} doldurulmamış alan`,
      detail:
        "Metinde şablondan kalan boş alanlar (___) var. İmzaya göndermeden önce doldurun; " +
        "boş bırakılan alan sonradan tek taraflı doldurulabilir hâle gelir.",
    });
  }

  // --- 2) Gövde çok kısa ---
  // 200 karakter, şablonların en kısasının bile epey altında; bu eşiğin
  // altındaki bir metin muhtemelen yanlışlıkla kaydedilmiş.
  if (body.trim().length > 0 && body.trim().length < 200) {
    riskler.push({
      level: "warning",
      code: "short_body",
      title: "Sözleşme metni çok kısa",
      detail: `Metin ${body.trim().length} karakter. Şablon yüklenmemiş ya da içerik eksik olabilir.`,
    });
  }

  // --- 3) Türüne göre beklenen maddeler ---
  const beklenen = EXPECTED_CLAUSES[input.contractType] ?? [];
  const lower = body.toLocaleLowerCase("tr-TR");
  const eksik = beklenen.filter((c) => !lower.includes(c.key));
  if (eksik.length > 0) {
    riskler.push({
      level: "warning",
      code: "missing_clause",
      title: `${eksik.length} madde metinde bulunamadı`,
      detail:
        `Aranan: ${eksik.map((c) => c.label).join(", ")}. ` +
        "Tarama yalnızca anahtar kelime arar; farklı bir ifadeyle yazdıysanız bu uyarıyı yok sayın.",
    });
  }

  // --- 4) İmzacı tanımlanmamış ---
  if (input.signerCount === 0 && !taslak) {
    riskler.push({
      level: "error",
      code: "no_signers",
      title: "İmzacı tanımlanmamış",
      detail: "Sözleşme taslak aşamasını geçmiş ama hiç imzacı eklenmemiş.",
    });
  }

  // --- 5) Tarih tutarlılığı ---
  if (gecerliTarih(input.expiresAt)) {
    const kalan = gunFarki(input.expiresAt as string, now.toISOString());
    if (kalan < 0 && !imzalandi) {
      riskler.push({
        level: "error",
        code: "expired_unsigned",
        title: "Geçerlilik süresi dolmuş",
        detail: `Son geçerlilik tarihi ${Math.abs(kalan)} gün önce geçti ve sözleşme hâlâ imzalanmadı.`,
      });
    } else if (kalan >= 0 && kalan <= 7 && !imzalandi) {
      riskler.push({
        level: "warning",
        code: "expiring_soon",
        title: "Geçerlilik süresi doluyor",
        detail: `${kalan} gün kaldı. İmza süreci tamamlanmazsa yeniden düzenlemek gerekecek.`,
      });
    }

    // İmza tarihinin geçerlilik tarihinden SONRA olması mantıksal çelişki.
    if (gecerliTarih(input.signedAt) && gunFarki(input.signedAt as string, input.expiresAt as string) > 0) {
      riskler.push({
        level: "error",
        code: "signed_after_expiry",
        title: "İmza tarihi geçerlilik tarihinden sonra",
        detail: "Sözleşme, geçerlilik süresi dolduktan sonra imzalanmış görünüyor. Tarihleri kontrol edin.",
      });
    }
  }

  if (gecerliTarih(input.signedAt) && gecerliTarih(input.createdAt)) {
    if (gunFarki(input.signedAt as string, input.createdAt as string) < 0) {
      riskler.push({
        level: "error",
        code: "signed_before_created",
        title: "İmza tarihi oluşturma tarihinden önce",
        detail: "Kayıt tarihleri tutarsız; veri girişi hatası olabilir.",
      });
    }
  }

  // --- 6) Bağlantı eksikliği ---
  if (!input.hasProperty) {
    riskler.push({
      level: "info",
      code: "no_property",
      title: "Portföy bağlanmamış",
      detail: "Sözleşme bir portföye bağlı değil; raporlarda ve denetimde eşleştirilemez.",
    });
  }
  if (!input.hasCustomer) {
    riskler.push({
      level: "info",
      code: "no_customer",
      title: "Müşteri bağlanmamış",
      detail: "Sözleşme bir müşteriye bağlı değil; geçmiş ve İYS izni ile ilişkilendirilemez.",
    });
  }

  // --- 7) Hizmet bedeli üst sınırı ---
  if (input.commissionRate != null && input.commissionRate > COMMISSION_CAP_PCT) {
    riskler.push({
      level: "warning",
      code: "commission_cap",
      title: `Komisyon oranı %${input.commissionRate}`,
      detail:
        `Taşınmaz Ticareti Yönetmeliği hizmet bedeline üst sınır getiriyor (yaygın uygulama %${COMMISSION_CAP_PCT}). ` +
        "Bu bir hukuki tespit değil, teyit uyarısıdır — güncel mevzuatı ve sözleşme türünü kontrol edin.",
    });
  }

  // Ağırdan hafife: kullanıcı önce durduracak olanı görsün.
  const sira: Record<RiskLevel, number> = { error: 0, warning: 1, info: 2 };
  return riskler.sort((a, b) => sira[a.level] - sira[b.level]);
}

/** Özet sayaç — rozet göstermek için. */
export function riskSummary(riskler: ContractRisk[]) {
  return {
    error: riskler.filter((r) => r.level === "error").length,
    warning: riskler.filter((r) => r.level === "warning").length,
    info: riskler.filter((r) => r.level === "info").length,
    total: riskler.length,
  };
}
