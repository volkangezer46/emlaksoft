import { FilterChip } from "@/components/ui/filter-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "@/components/ui/smart-link";
import { Search, Settings } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { SecretsMigration } from "@/components/settings/secrets-migration";
import { SettingField } from "@/components/settings/setting-field";
import { requirePlatformModule } from "@/lib/platform";
import { isPlatformMfaRequired, platformMfaSyncIssue } from "@/lib/platform-mfa";
import { getPlatformSetting } from "@/lib/platform-settings";
import { platformSecretsKeySource } from "@/lib/platform-secrets";
import { getPlatformSettingViews } from "@/lib/settings/read";
import { getSettingDef } from "@/lib/settings/registry";
import { SETTING_CATEGORIES, type SettingCategoryId, type SettingView } from "@/lib/settings/types";

export const metadata = { title: "Sistem ayarları merkezi" };

type Sp = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const norm = (s: string) => s.toLocaleLowerCase("tr-TR");

/** Merkezde kendi ayar satırı olmayan kategorilerin gerçek hedefleri (boş/çıkmaz kategori yok). */
const CATEGORY_LINKS: Partial<Record<SettingCategoryId, { label: string; href: string }[]>> = {
  cron: [{ label: "Cron nabzı ve elle çalıştırma (zamanlama kodda ve vercel.json içindedir, buradan değiştirilemez)", href: "/admin/sistem" }],
  uyum: [
    { label: "TÜFE tablosu (kira artışı oranları)", href: "/admin/ayarlar/tufe" },
    { label: "Aktivite kaydı (denetim izi)", href: "/admin/aktivite" },
  ],
  gorunum: [
    { label: "Marka (logo ve favicon)", href: "/admin/marka" },
    { label: "SEO merkezi (taslak/yayın, geçmiş)", href: "/admin/seo" },
    { label: "Site menüsü", href: "/admin/site-menu" },
    { label: "Site içeriği", href: "/admin/site-icerik" },
  ],
  saglik: [
    { label: "Sistem sağlığı ve cron nabzı", href: "/admin/sistem" },
    { label: "Hata kayıtları", href: "/admin/hatalar" },
  ],
};

/** Merkez: ayarların TEK vitrini. Mevcut ekranlar (planlar, ef-kontör, growth, seo, site, marka) kalır; merkez köprü + arama. */
export default async function SettingsCenterPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const staff = await requirePlatformModule("sistem");
  const sp = await searchParams;
  const q = first(sp.ara).trim();
  const catParam = first(sp.kategori);
  const category = SETTING_CATEGORIES.find((c) => c.id === catParam)?.id as SettingCategoryId | undefined;
  const canEdit = staff.role === "super_admin";

  const [views, mfaDb] = await Promise.all([getPlatformSettingViews(), getPlatformSetting("platform.mfa_enforced")]);

  const counts = new Map<string, number>();
  for (const v of views) counts.set(v.category, (counts.get(v.category) ?? 0) + 1);

  const needle = norm(q);
  const shown = views.filter(
    (v) =>
      (!category || v.category === category) &&
      (!needle || norm(v.label).includes(needle) || norm(v.description).includes(needle) || norm(v.key).includes(needle)),
  );
  const byCat = SETTING_CATEGORIES.map((c) => ({ ...c, items: shown.filter((v) => v.category === c.id) })).filter(
    (c) => c.items.length > 0 || (!needle && (!category || category === c.id) && (CATEGORY_LINKS[c.id]?.length ?? 0) > 0),
  );

  const plaintextKeys = views.filter((v) => v.sensitivity === "secret" && v.plaintext).map((v) => v.key);
  const mfaIssue = platformMfaSyncIssue(isPlatformMfaRequired(), mfaDb);

  const href = (kategori?: string) => {
    const p = new URLSearchParams();
    if (kategori) p.set("kategori", kategori);
    if (q) p.set("ara", q);
    const s = p.toString();
    return `/admin/ayarlar/merkez${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Platform"
        icon={Settings}
        title="Sistem ayarları merkezi"
        description="Web'den yönetilebilir ayarlar: her değişiklik doğrulanır, geçmişe yazılır ve geri alınabilir. Gizli anahtarlar şifreli saklanır ve asla gösterilmez."
      />

      <form action="/admin/ayarlar/merkez" className="flex max-w-xl items-center gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Ayar ara</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <Input name="ara" defaultValue={q} placeholder="Ayar ara (ör. deneme, bakım, anahtar)" className="pl-9" />
        </label>
        {category ? <input type="hidden" name="kategori" value={category} /> : null}
        <Button variant="navy" size="sm" type="submit">
          Ara
        </Button>
      </form>

      <nav aria-label="Ayar kategorileri" className="flex flex-wrap gap-2">
        <FilterChip href={href()} active={!category}>
          Tümü ({views.length})
        </FilterChip>
        {SETTING_CATEGORIES.map((c) => (
          <FilterChip key={c.id} href={href(c.id)} active={category === c.id}>
            {c.label} ({(counts.get(c.id) ?? 0) + (CATEGORY_LINKS[c.id]?.length ?? 0)})
          </FilterChip>
        ))}
      </nav>

      {mfaIssue ? (
        <p role="status" className="rounded-[var(--radius-card)] border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          {mfaIssue === "env_on_db_off"
            ? "MFA tutarsız: ortam değişkeni açık ama veritabanı ayarı kapalı. Bu merkez zorunlu MFA'yı kendiliğinden açmaz; yayın runbook'una göre ayarı ayrıca açın."
            : "MFA tutarsız: veritabanı ayarı açık ama ortam değişkeni kapalı."}
        </p>
      ) : null}

      {!category || category === "entegrasyon" || category === "ai" || category === "bildirim" ? (
        <SecretsMigration plaintextKeys={plaintextKeys} canRun={canEdit} keySource={platformSecretsKeySource()} />
      ) : null}

      {byCat.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line px-4 py-10 text-center text-sm text-text-muted">
          {q ? `“${q}” için ayar bulunamadı.` : "Bu kategoride ayar yok."}{" "}
          <Link href="/admin/ayarlar/merkez" className="font-semibold text-brand-600 hover:underline">
            Tüm ayarlar
          </Link>
        </p>
      ) : (
        byCat.map((c) => (
          <section key={c.id} aria-labelledby={`cat-${c.id}`} className="space-y-3">
            <div>
              <h2 id={`cat-${c.id}`} className="text-base font-semibold text-ink-950">
                {c.label}
              </h2>
              <p className="text-xs text-text-muted">{c.description}</p>
            </div>
            {c.items.length === 0 ? (
              <ul className="space-y-1 rounded-[var(--radius-panel)] border border-line bg-surface p-4 text-xs">
                {(CATEGORY_LINKS[c.id] ?? []).map((l) => (
                  <li key={l.href + l.label}>
                    <Link href={l.href} className="font-semibold text-brand-600 hover:underline">
                      {l.label} →
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="grid gap-3">
              {c.items.map((v: SettingView) => {
                // Konuya ait ayar kendi bölümünde düzenlenir (tek yer); merkez yalnız değeri ve bağlantıyı gösterir.
                const home = getSettingDef(v.key)?.home;
                return home ? (
                  <Link
                    key={v.key}
                    href={home.href}
                    className="focus-ring flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3 text-sm transition hover:border-brand-300"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink-950">{v.label}</span>
                      <span className="block text-xs text-text-muted">Şu an: {v.display} · {home.label} bölümünde düzenlenir</span>
                    </span>
                    <span className="text-xs font-semibold text-brand-600">Düzenle →</span>
                  </Link>
                ) : (
                  <SettingField key={v.key} view={v} canEdit={canEdit} />
                );
              })}
            </div>
          </section>
        ))
      )}

      <section aria-labelledby="bridge-title" className="space-y-2 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
        <h2 id="bridge-title" className="text-sm font-semibold text-ink-950">
          Kendi ekranında yönetilenler (köprü)
        </h2>
        <ul className="grid gap-1 text-xs sm:grid-cols-2">
          {[
            ["Plan fiyatları, koltuk, kampanya", "/admin/billing/planlar"],
            ["EmlakFiyatı kontör tarifesi ve paketler", "/admin/ef-kontor"],
            ["Büyüme bayrakları ve kurallar", "/admin/growth"],
            ["SEO merkezi (taslak/yayın)", "/admin/seo"],
            ["Site içeriği", "/admin/site-icerik"],
            ["Site menüsü", "/admin/site-menu"],
            ["Marka (logo, favicon)", "/admin/marka"],
            ["TÜFE tablosu", "/admin/ayarlar/tufe"],
            ["Kayıt ve bakım modu", "/admin/sistem#ayarlar"],
            ["Deneme süresi ve otomatik yenileme", "/admin/billing#ayarlar"],
            ["Özellik bayrakları", "/admin/ayarlar/bayraklar"],
            ["Yasal metinler ve mevzuat sabitleri", "/admin/ayarlar/yasal"],
            ["Sistem sağlığı, cron nabzı ve entegrasyon formları", "/admin/sistem"],
          ].map(([label, to]) => (
            <li key={to}>
              <Link href={to} className="font-semibold text-brand-600 hover:underline">
                {label} →
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}