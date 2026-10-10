/**
 * Ofis profili eksiklik hesabı — SAF (I/O yok; ana ekran kartı ve /app/ayarlar/profil-tamamla sihirbazı AYNI kaynağı kullanır).
 *
 * Kısa kayıt yalnız hesap + ofis adı + paket ister; konum, iletişim, belge, marka, odak ve ekip bilgisi uygulama içinde
 * adım adım tamamlanır. Tamamlanma yalnız tenants/profiles'taki gerçek alanlardan çıkar (sahte ilerleme yok).
 * `extAvailable=false` (genişletme sütunları — ofis türü, odak, ilçeler — henüz yok) ise bu maddeler listeye hiç girmez.
 */

export type ProfileStepKey = "konum" | "iletisim" | "fatura" | "marka" | "odak" | "ekip";

export const PROFILE_STEPS: readonly { key: ProfileStepKey; label: string; description: string }[] = [
  { key: "konum", label: "Konum", description: "Ofisin hangi ilde ve ilçede, tam adresi nedir?" },
  { key: "iletisim", label: "İletişim ve belge", description: "Müşterilerin ulaşacağı telefon ve taşınmaz ticareti yetki belgen." },
  { key: "fatura", label: "Vergi ve fatura", description: "Ödeme ve fatura için vergi / T.C. kimlik numaran." },
  { key: "marka", label: "Marka", description: "Logo ve renk: panel, vitrin ve belgelerde görünür." },
  { key: "odak", label: "Çalışma odağı", description: "Ofis türün, ne sattığın ve hangi ilçelerde çalıştığın." },
  { key: "ekip", label: "Ekip", description: "Danışmanlarını e-posta ile davet et." },
] as const;

export function isProfileStepKey(v: unknown): v is ProfileStepKey {
  return PROFILE_STEPS.some((s) => s.key === v);
}

export type ProfileFacts = {
  provinceId: string | null;
  districtId: string | null;
  addressLine: string | null;
  phone: string | null;
  licenseNo: string | null;
  taxNumber: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  /** tenants genişletme sütunları okunabildi mi (migration 20261006000600). */
  extAvailable: boolean;
  officeType: string | null;
  focusSegments: readonly string[] | null;
  workDistrictIds: readonly string[] | null;
  /** Ofisteki kişi sayısı (kurucu dahil). */
  memberCount: number;
};

export type ProfileItem = { id: string; label: string; step: ProfileStepKey; done: boolean };

export type ProfileCompletion = {
  items: ProfileItem[];
  missing: ProfileItem[];
  doneCount: number;
  total: number;
  percent: number;
  complete: boolean;
  /** İlk eksik maddenin adımı; hepsi tamamsa null. */
  nextStep: ProfileStepKey | null;
  /** Adım -> o adımdaki eksik madde sayısı. */
  missingByStep: Record<ProfileStepKey, number>;
};

/** Fatura için en az karakter (saveOfficeProfile ile aynı kural). */
export const ADDRESS_MIN = 10;

const filled = (v: string | null | undefined) => Boolean(v && v.trim());

export function computeProfileCompletion(f: ProfileFacts): ProfileCompletion {
  const items: ProfileItem[] = [
    { id: "konum", label: "Ofisin ili ve ilçesi", step: "konum", done: Boolean(f.provinceId && f.districtId) },
    { id: "adres", label: "Açık adres", step: "konum", done: (f.addressLine ?? "").trim().length >= ADDRESS_MIN },
    { id: "telefon", label: "Ofis telefonu", step: "iletisim", done: filled(f.phone) },
    { id: "yetki", label: "Yetki belgesi no", step: "iletisim", done: filled(f.licenseNo) },
    { id: "vergi", label: "Vergi / T.C. kimlik no", step: "fatura", done: filled(f.taxNumber) },
    { id: "logo", label: "Ofis logosu", step: "marka", done: filled(f.logoUrl) },
    { id: "renk", label: "Marka rengi", step: "marka", done: filled(f.brandColor) },
  ];
  if (f.extAvailable) {
    items.push(
      { id: "tur", label: "Ofis türü", step: "odak", done: filled(f.officeType) },
      { id: "odak", label: "Çalışma odağı", step: "odak", done: (f.focusSegments?.length ?? 0) > 0 },
      { id: "ilce", label: "Çalışılan ilçeler", step: "odak", done: (f.workDistrictIds?.length ?? 0) > 0 },
    );
  }
  items.push({ id: "ekip", label: "Ekip daveti", step: "ekip", done: f.memberCount > 1 });

  const missing = items.filter((i) => !i.done);
  const doneCount = items.length - missing.length;
  const missingByStep = Object.fromEntries(PROFILE_STEPS.map((s) => [s.key, 0])) as Record<ProfileStepKey, number>;
  for (const m of missing) missingByStep[m.step] += 1;
  return {
    items,
    missing,
    doneCount,
    total: items.length,
    percent: items.length === 0 ? 100 : Math.round((doneCount / items.length) * 100),
    complete: missing.length === 0,
    nextStep: missing[0]?.step ?? null,
    missingByStep,
  };
}

/**
 * Kurulum sihirbazının "Ofis bilgileri" adımı bu hesaba bağlıdır (TEK ilerleme modeli): ekip daveti hariç tüm
 * profil maddeleri tamamsa adım tamamdır; "Ekip" kurulumda ayrı adım olduğundan burada sayılmaz.
 */
export function isOfficeProfileDone(c: ProfileCompletion): boolean {
  return c.missing.every((m) => m.step === "ekip");
}

/**
 * Kurulum sihirbazının "Ofis" adımı yalnız konum maddelerine (il/ilçe + açık adres) bağlıdır; telefon, yetki belgesi,
 * vergi, marka ve odak ayrıntıları isteğe bağlıdır (Ayarlar > Marka ve kimlik) ve ilerlemeyi bloklamaz.
 */
export function isOfficeLocationDone(c: ProfileCompletion): boolean {
  return c.items.filter((i) => i.step === "konum").every((i) => i.done);
}

/** Eski "Ofis profilini tamamla" adresi: artık Kurulum sihirbazına yönlenir (eski bağlantılar kırılmaz). */
export const PROFILE_WIZARD_HREF = "/app/ayarlar/profil-tamamla";

export function profileStepHref(step: ProfileStepKey): string {
  return `${PROFILE_WIZARD_HREF}?adim=${step}`;
}

/** Adım sırası içinde komşular (kaydet-ve-devam). */
export function profileStepNeighbors(step: ProfileStepKey): { prev: ProfileStepKey | null; next: ProfileStepKey | null } {
  const i = PROFILE_STEPS.findIndex((s) => s.key === step);
  return { prev: PROFILE_STEPS[i - 1]?.key ?? null, next: PROFILE_STEPS[i + 1]?.key ?? null };
}

/** `?adim=`: geçerliyse o adım; yoksa ilk eksik adım; hepsi tamamsa ilk adım. */
export function resolveProfileStep(param: string | null | undefined, completion: ProfileCompletion): ProfileStepKey {
  if (isProfileStepKey(param)) return param;
  return completion.nextStep ?? PROFILE_STEPS[0]!.key;
}
