/**
 * Giriş sayfasındaki hızlı test kişilikleri.
 * Parola yalnızca sunucu tarafında (`demo-login.ts`) tutulur — istemciye gitmez.
 */

export type DemoPersonaKind = "platform" | "office";

export type DemoPersona = {
  id: string;
  kind: DemoPersonaKind;
  label: string;
  hint: string;
  email: string;
  /** platform_staff.role veya profiles.role */
  role: string;
};

export const DEMO_PERSONAS: DemoPersona[] = [
  // —— EmlakSoft personeli ——
  {
    id: "super_admin",
    kind: "platform",
    label: "Süper admin",
    hint: "Tam yetki · /admin",
    email: "admin@demo.emlaksoft.test",
    role: "super_admin",
  },
  {
    id: "ops",
    kind: "platform",
    label: "Operasyon",
    hint: "Ofis & sistem",
    email: "ops@demo.emlaksoft.test",
    role: "ops",
  },
  {
    id: "support",
    kind: "platform",
    label: "Müşteri temsilcisi",
    hint: "Destek kuyruğu",
    email: "destek@demo.emlaksoft.test",
    role: "support",
  },
  {
    id: "billing",
    kind: "platform",
    label: "Muhasebe",
    hint: "Abonelik & fatura",
    email: "muhasebe@demo.emlaksoft.test",
    role: "billing",
  },
  // —— Ofis kullanıcıları ——
  {
    id: "owner",
    kind: "office",
    label: "Ofis sahibi",
    hint: "Tam ofis yetkisi",
    email: "sahip@demo.emlaksoft.test",
    role: "owner",
  },
  {
    id: "gm",
    kind: "office",
    label: "Genel müdür",
    hint: "Yönetim paneli",
    email: "mudur@demo.emlaksoft.test",
    role: "gm",
  },
  {
    id: "branch_manager",
    kind: "office",
    label: "Şube müdürü",
    hint: "Şube operasyonu",
    email: "sube@demo.emlaksoft.test",
    role: "branch_manager",
  },
  {
    id: "team_lead",
    kind: "office",
    label: "Takım lideri",
    hint: "Ekip & portföy",
    email: "takim@demo.emlaksoft.test",
    role: "team_lead",
  },
  {
    id: "advisor",
    kind: "office",
    label: "Danışman",
    hint: "Satış & müşteri",
    email: "danisman@demo.emlaksoft.test",
    role: "advisor",
  },
  {
    id: "call_center",
    kind: "office",
    label: "Çağrı merkezi",
    hint: "Arama & randevu",
    email: "cagri@demo.emlaksoft.test",
    role: "call_center",
  },
  {
    id: "accounting",
    kind: "office",
    label: "Ofis muhasebe",
    hint: "Komisyon & fatura",
    email: "ofis-muhasebe@demo.emlaksoft.test",
    role: "accounting",
  },
  {
    id: "readonly",
    kind: "office",
    label: "Salt okunur",
    hint: "Sadece görüntüleme",
    email: "izleyici@demo.emlaksoft.test",
    role: "readonly",
  },
];

export function getDemoPersona(id: string): DemoPersona | undefined {
  return DEMO_PERSONAS.find((p) => p.id === id);
}

/** Geliştirme ortamında veya ENABLE_DEMO_LOGIN=true iken açık. */
export function isDemoLoginEnabled(): boolean {
  if (process.env.ENABLE_DEMO_LOGIN === "true") return true;
  if (process.env.ENABLE_DEMO_LOGIN === "false") return false;
  return process.env.NODE_ENV === "development";
}
