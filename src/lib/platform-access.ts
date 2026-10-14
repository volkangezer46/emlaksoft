/**
 * EmlakSoft iç personeli (platform_staff) departman erişim modeli — TEK KAYNAK.
 * Tenant tarafındaki rol×modül matrisinin platform karşılığı: her departman yalnızca
 * kendi ekranlarını görür. Bu dosya SUNUCU/İSTEMCİ ortak kullanılabilir (saf, yan etkisiz).
 *
 * DG1: sabit roller (super_admin/ops/support/billing) modül × eylem (görüntüle/yaz/onayla) matrisine haritalanır
 * (`fixedRoleMatrix`, geriye uyumlu); personele DB'de tanımlı bir ÖZEL ROL atanırsa yalnız o rolün matrisi geçerlidir.
 * Kapılar (`requirePlatformModule`, `guardPlatformAction`, menü) özneyi (`PlatformAccessSubject`) alır: sabit rol adı
 * ya da personel kaydı (rol + özel rol).
 */

export type PlatformRole = "super_admin" | "ops" | "support" | "billing";

export type PlatformModule =
  | "dashboard"
  | "sales"
  | "tenants"
  | "members"
  | "billing"
  | "tickets"
  | "reports"
  | "advisor"
  | "activity"
  | "geo"
  | "sistem"
  | "broadcast"
  | "personel"
  | "marka"
  | "seo"
  | "sitemenu"
  | "sitecontent"
  | "reklam"
  /** SN4 salt okunur veri gezgini: varsayılan yalnız süper admin; başka personele yalnız özel rolle verilir. */
  | "veri";

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  super_admin: "Süper admin",
  ops: "Operasyon",
  support: "Müşteri temsilcisi",
  billing: "Muhasebe",
};

/** Departmanların kısa açıklaması (sidebar/başlık için). */
export const PLATFORM_ROLE_TAGLINES: Record<PlatformRole, string> = {
  super_admin: "Tam yetki · tüm platform",
  ops: "Tenant operasyonu & sistem",
  support: "Destek kuyruğu & müşteri",
  billing: "Abonelik, fatura & gelir",
};

/**
 * Rol → erişilebilir modüller. `dashboard` herkeste var; içeriği role göre uyarlanır.
 */
export const PLATFORM_ROLE_MODULES: Record<PlatformRole, PlatformModule[]> = {
  super_admin: ["dashboard", "sales", "tenants", "members", "billing", "tickets", "reports", "advisor", "activity", "geo", "sistem", "broadcast", "personel", "marka", "seo", "sitemenu", "sitecontent", "reklam", "veri"],
  ops: ["dashboard", "sales", "tenants", "members", "tickets", "reports", "advisor", "activity", "geo", "sistem", "broadcast", "seo", "sitemenu", "sitecontent", "reklam"],
  billing: ["dashboard", "billing", "tenants", "reports", "advisor", "tickets"],
  support: ["dashboard", "sales", "tickets", "members", "tenants"],
};

/**
 * Görüntüleyebildiği ama DEĞİŞTİREMEDİĞİ modüller (sayfalar `readonly` kipinde açılır). `reklam`: Google bağlantıları,
 * reklam panosu — bağlama/kesme/gizli değer girişi yalnız super_admin; ops yalnız izler.
 */
export const PLATFORM_READONLY_MODULES: Partial<Record<PlatformRole, PlatformModule[]>> = {
  ops: ["reklam"],
};

// ---------------------------------------------------------------------------
// DG1 — modül × eylem matrisi (görüntüle / yaz / onayla) ve personel özel rolleri
// ---------------------------------------------------------------------------

/**
 * Eylem düzeyleri: `view` ekranı görür (salt okunur), `write` sıradan işlemleri yapar, `approve` kritik işlemleri
 * (iade, kredi, ofis kapatma, rol değişikliği) yapar ve dört göz kuyruğunda BAŞKASININ talebini onaylar.
 * Düzeyler iç içedir: approve ⊇ write ⊇ view (bkz. `normalizeActions`).
 */
export type PlatformAction = "view" | "write" | "approve";
export const PLATFORM_ACTIONS: readonly PlatformAction[] = ["view", "write", "approve"];
export const PLATFORM_ACTION_LABELS: Record<PlatformAction, string> = {
  view: "Görüntüle",
  write: "Yaz",
  approve: "Onayla",
};

/** Tüm modüller (sıra = menü/matris sırası). */
export const PLATFORM_MODULES: readonly PlatformModule[] = PLATFORM_ROLE_MODULES.super_admin;

export type PlatformPermissionMatrix = Partial<Record<PlatformModule, readonly PlatformAction[]>>;

/** Özel rolün dayandığı sabit rol: rol adına bakan ince kurallar (ör. panel düzeni) bundan gelir. Süper admin olamaz. */
export type PlatformBaseRole = Exclude<PlatformRole, "super_admin">;
export const PLATFORM_BASE_ROLES: readonly PlatformBaseRole[] = ["ops", "support", "billing"];

export type PlatformCustomRole = {
  id: string;
  label: string;
  baseRole: PlatformBaseRole;
  permissions: PlatformPermissionMatrix;
};

/** Yetki öznesi: sabit rol adı ya da (personel kaydı gibi) rol + isteğe bağlı özel rol. */
export type PlatformPrincipal = { role: PlatformRole; customRole?: PlatformCustomRole | null };
export type PlatformAccessSubject = PlatformRole | PlatformPrincipal;

const isModule = (m: string): m is PlatformModule => (PLATFORM_MODULES as readonly string[]).includes(m);
const isAction = (a: unknown): a is PlatformAction => a === "view" || a === "write" || a === "approve";

export function isPlatformBaseRole(v: unknown): v is PlatformBaseRole {
  return v === "ops" || v === "support" || v === "billing";
}

/**
 * Eylem listesini kanonik biçime getirir. Düzeyler iç içedir: approve ⊇ write ⊇ view (onaylayan, onayladığı işlemi
 * kendi adıyla yürütür; bu yüzden yazma yetkisini de taşır). Sıra view → write → approve.
 */
export function normalizeActions(actions: readonly unknown[]): PlatformAction[] {
  const set = new Set(actions.filter(isAction));
  if (set.has("approve")) set.add("write");
  if (set.size > 0) set.add("view");
  return PLATFORM_ACTIONS.filter((a) => set.has(a));
}

/**
 * DB'den (jsonb) gelen ham matrisi süzer: bilinmeyen modül/eylem atılır, boş modül yazılmaz. `dashboard` her
 * personelde görüntülenir (giriş ekranı; içerik ayrıca modül kapılıdır).
 */
export function normalizeMatrix(raw: unknown): PlatformPermissionMatrix {
  const out: PlatformPermissionMatrix = { dashboard: ["view"] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [mod, acts] of Object.entries(raw as Record<string, unknown>)) {
    if (!isModule(mod) || !Array.isArray(acts)) continue;
    const norm = normalizeActions([...(out[mod] ?? []), ...acts]);
    if (norm.length > 0) out[mod] = norm;
  }
  return out;
}

/**
 * Sabit rolün matris karşılığı (GERİYE UYUMLU haritalama; kaynak PLATFORM_ROLE_MODULES + PLATFORM_READONLY_MODULES):
 * erişilen modül = view + write, salt okunur modül = yalnız view; süper admin her modülde ayrıca approve taşır
 * (eskiden "yalnız süper admin" olan kritik işlemler).
 */
export function fixedRoleMatrix(role: PlatformRole): PlatformPermissionMatrix {
  const out: PlatformPermissionMatrix = {};
  const readonly = PLATFORM_READONLY_MODULES[role] ?? [];
  for (const m of PLATFORM_ROLE_MODULES[role] ?? ["dashboard"]) {
    out[m] = readonly.includes(m) ? ["view"] : role === "super_admin" ? ["view", "write", "approve"] : ["view", "write"];
  }
  return out;
}

/** Öznenin sabit (taban) rolü: rol adı karşılaştıran eski kurallar bunu kullanır. */
export function baseRoleOf(subject: PlatformAccessSubject): PlatformRole {
  return typeof subject === "string" ? subject : subject.role;
}

/** Etkin matris: özel rol atanmışsa YALNIZ onun matrisi (taban rolün modülleri eklenmez), yoksa sabit rolün matrisi. */
export function platformMatrixFor(subject: PlatformAccessSubject): PlatformPermissionMatrix {
  if (typeof subject !== "string" && subject.customRole) return normalizeMatrix(subject.customRole.permissions);
  return fixedRoleMatrix(baseRoleOf(subject));
}

export function platformCan(subject: PlatformAccessSubject, module: PlatformModule, action: PlatformAction): boolean {
  return platformMatrixFor(subject)[module]?.includes(action) ?? false;
}

/** Öznenin görebildiği modüller (menü, sekmeler, rozetler bu listeden süzülür). */
export function platformModulesFor(subject: PlatformAccessSubject): PlatformModule[] {
  const matrix = platformMatrixFor(subject);
  const mods = PLATFORM_MODULES.filter((m) => matrix[m]?.includes("view"));
  return mods.length > 0 ? mods : ["dashboard"];
}

export function platformCanAccess(subject: PlatformAccessSubject, module: PlatformModule): boolean {
  return platformCan(subject, module, "view");
}

/** Başlıkta/listede gösterilen rol adı (özel rol adı öncelikli). */
export function platformRoleLabel(subject: PlatformAccessSubject): string {
  if (typeof subject !== "string" && subject.customRole) return subject.customRole.label;
  const role = baseRoleOf(subject);
  return PLATFORM_ROLE_LABELS[role] ?? role;
}

export type PlatformModuleMode = "write" | "readonly" | "none";

export function platformModuleMode(subject: PlatformAccessSubject, module: PlatformModule): PlatformModuleMode {
  if (!platformCanAccess(subject, module)) return "none";
  return platformCan(subject, module, "write") ? "write" : "readonly";
}

/** Giriş sonrası departmanın varsayılan açılış ekranı. */
export function platformHome(role: PlatformRole): string {
  switch (role) {
    case "billing":
    case "support":
    case "ops":
    case "super_admin":
    default:
      // Dashboard role göre uyarlandığı için herkes /admin'e iner.
      return "/admin";
  }
}
