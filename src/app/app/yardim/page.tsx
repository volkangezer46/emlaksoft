import Link from "@/components/ui/smart-link";
import { FilterChip } from "@/components/ui/filter-chip";
import { ArrowRight, LifeBuoy, Mail, MessageCircle, Phone } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { requireModulePage } from "@/lib/require-module-page";
import { HELP_TABS, resolveHelpTab, type GlossaryEntry, type HelpTab } from "@/lib/help-content";
import { getHelpContent } from "@/lib/help-center/store";
import { loadOnboardingState } from "../_home/data";
import { effectiveHasPermission, type EffectivePermissions } from "@/lib/permissions-effective";
import { boardEnabledFor } from "@/lib/product-feedback/store";
import { TourPicker } from "./restart-tour-button";
import { getSupportContact } from "@/lib/contact-info-server";
import { formatPhoneDisplay } from "@/lib/phone";
import { loadOnboardingContent } from "@/lib/onboarding-content-read";
import { resolveTours } from "@/lib/onboarding-content";
import { listableTours } from "@/lib/product-tour-data";
import { getClosedFeatures } from "@/lib/modules/state";
import type { AppAction, AppModule } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { FaqSearch, GuidesSearch } from "./help-search";
import { FeatureBoardTab } from "./feature-board";
import { IconChip } from "@/components/ui/icons";

export async function generateMetadata({ searchParams }: { searchParams?: Promise<{ sekme?: string }> }) {
  const sekme = (await searchParams)?.sekme;
  const tab = HELP_TABS.find((t) => t.id === sekme);
  return { title: tab && tab.id !== "baslangic" ? `${tab.label} · Yardım` : "Yardım" };
}

const PANEL = "rounded-[var(--radius-panel)] border border-line bg-surface p-5";

/** Sayfa içi sekmeler. Destek talepleri üstteki şeridin "Destek" sekmesidir (/app/destek); burada kopyası yok. */
const PAGE_TABS = HELP_TABS;

function tabHref(tab: HelpTab) {
  return tab === "baslangic" ? "/app/yardim" : `/app/yardim?sekme=${tab}`;
}

/**
 * Yardım merkezi: Başlangıç (kurulum kontrol listesi), Rehberler (görev bazlı
 * adımlar), SSS ve Sözlük (jargon → ofis dili). İçerik yardım merkezi CMS'inden gelir: koddaki taban
 * (src/lib/help-content.ts, help-faq.ts) + yayındaki DB makaleleri (src/lib/help-center; /admin/tickets/yardim). Yayın
 * önbellek etiketini tazeler: yeni makale hemen aranabilir. Destek talepleri merkezin "Destek" sekmesidir (/app/destek).
 * Öneri panosu (DG8): ofisler özellik önerir ve oy verir (ofis başına tek oy); EmlakSoft durumu günceller.
 */
export default async function HelpPage({ searchParams }: { searchParams?: Promise<{ sekme?: string; q?: string; durum?: string }> }) {
  const [{ tenantId, perms, role }, sp, help, support] = await Promise.all([
    requireModulePage("support"),
    searchParams,
    getHelpContent(),
    getSupportContact(),
  ]);
  // Öneri panosu (DG8) hedeflenebilir bayraktır: kapalı/hedef dışı ofiste sekme görünmez, adres Başlangıç'a düşer.
  const boardOn = tenantId ? await boardEnabledFor(tenantId).catch(() => false) : false;
  const tabs = boardOn ? PAGE_TABS : PAGE_TABS.filter((t) => t.id !== "oneriler");
  const resolved = resolveHelpTab(sp?.sekme);
  const tab = resolved === "oneriler" && !boardOn ? "baslangic" : resolved;
  const q = (sp?.q ?? "").slice(0, 100);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader icon={<IconChip icon={LifeBuoy} size="lg" />}
        eyebrow="Yardım ve Destek"
        title="Size nasıl yardımcı olabiliriz?"
        description="Bize yazın, kısa turu izleyin ya da sık sorulan sorulara bakın."
      />

      <SupportCard support={support} canOpenTicket={effectiveHasPermission(perms, "support", "create")} />

      <nav aria-label="Yardım bölümleri" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <FilterChip key={t.id} href={tabHref(t.id)} active={t.id === tab}>
            {t.label}
          </FilterChip>
        ))}
      </nav>

      {tab === "baslangic" ? <TourPickerSection tenantId={tenantId} role={role} perms={perms} /> : null}
      {tab === "baslangic" ? <SetupLine tenantId={tenantId} perms={perms} /> : null}
      {tab === "rehberler" ? <GuidesSearch initialQ={q} guides={help.guides} /> : null}
      {tab === "sss" ? <FaqSearch initialQ={q} faq={help.faq} /> : null}
      {tab === "sozluk" ? <GlossaryTab glossary={help.glossary} /> : null}
      {tab === "oneriler" && tenantId ? <FeatureBoardTab tenantId={tenantId} filter={sp?.durum} canWrite={effectiveHasPermission(perms, "support", "create")} /> : null}
    </div>
  );
}

/**
 * Destek kartı (C29): ilk ekranda insana ulaşma yolu. Telefon ve WhatsApp yalnız ayar defterinde tanımlıysa görünür
 * (uydurma numara yok); e-posta her zaman vardır. Destek talebi, talep açma yetkisi olana.
 */
function SupportCard({ support, canOpenTicket }: { support: Awaited<ReturnType<typeof getSupportContact>>; canOpenTicket: boolean }) {
  const linkCls =
    "focus-ring inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold text-text transition hover:border-brand-300";
  return (
    <section aria-labelledby="destek" className={`${PANEL} space-y-3`} data-testid="destek-karti">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
          <LifeBuoy className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 id="destek" className="font-display text-lg font-bold text-ink-950">
            Bize yazın
          </h2>
          <p className="mt-0.5 text-base text-text-muted">Takıldığınız yeri anlatın, ekibimiz size dönsün.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {canOpenTicket ? (
          <ButtonLink href="/app/destek/yeni" iconRight={ArrowRight}>
            Destek talebi açın
          </ButtonLink>
        ) : null}
        {support.whatsappUrl ? (
          <a href={support.whatsappUrl} target="_blank" rel="noreferrer" className={linkCls}>
            <MessageCircle className="h-4 w-4 text-mint-600" aria-hidden /> WhatsApp
          </a>
        ) : null}
        {support.tel && support.phone ? (
          <a href={support.tel} className={linkCls}>
            <Phone className="h-4 w-4 text-brand-600" aria-hidden /> {formatPhoneDisplay(support.phone)}
          </a>
        ) : null}
        <a href={support.mailto} className={linkCls}>
          <Mail className="h-4 w-4 text-brand-600" aria-hidden /> {support.email}
        </a>
      </div>
    </section>
  );
}

/**
 * Kurulum durumu TEK satır (kurulum listesi burada kopyalanmaz; sihirbaz tek kaynaktır). Ana ekran kartıyla aynı sayım ve
 * yetki süzgeci; kurulum bittiyse satır yok.
 */
async function SetupLine({ tenantId, perms }: { tenantId: string | null; perms: EffectivePermissions }) {
  const state = tenantId ? await loadOnboardingState({ tenantId, perms }) : null;
  if (!state || state.complete || state.total === 0) return null;
  return (
    <div className={`${PANEL} flex flex-wrap items-center justify-between gap-3`}>
      <p className="text-base text-text">
        Kurulum <span className="font-semibold">%{state.percent}</span> tamam
      </p>
      <ButtonLink href="/app/baslangic" variant="secondary" iconRight={ArrowRight}>
        Kurulumu sürdürün
      </ButtonLink>
    </div>
  );
}

function GlossaryTab({ glossary }: { glossary: readonly GlossaryEntry[] }) {
  return (
    <section aria-label="Sözlük" className="space-y-3">
      <p className="text-sm text-text-muted">
        Ekranlarda gördüğünüz terimlerin ofis dilindeki karşılığı. Bir terimin yanındaki ? düğmesi sizi doğrudan buraya getirir.
      </p>
      <dl className="space-y-3">
        {glossary.map((g) => (
          <div key={g.slug} id={g.slug} className={`${PANEL} scroll-mt-24 target:border-brand-600`}>
            <dt className="font-display text-base font-bold text-ink-950">
              {g.term}
              {g.aka ? <span className="ml-2 text-sm font-normal text-text-muted">({g.aka})</span> : null}
            </dt>
            <dd className="mt-1.5 space-y-2 text-base leading-relaxed text-text">
              <p>{g.short}</p>
              {g.detail ? <p className="text-sm text-text-muted">{g.detail}</p> : null}
              {g.href ? (
                <Link
                  href={g.href}
                  className="focus-ring inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-600 hover:underline"
                >
                  {g.hrefLabel ?? "Sayfaya git"} <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Tur kartı (C29: yalnız rolün turu görünür, diğerleri katlı). Adminden düzenlenen ad/açıklama (Ofisler > Kurulum >
 * İçerik); okunamazsa koddaki varsayılan. Turlar, turun açılacağı bağlamla (rol + paket + yetki + kapalı modüller) aynı süzgeçten geçer: erişilebilir adımı
 * 3'ten az kalan turun kartı gösterilmez (tıklanınca hiçbir şey olmayan çıkmaz kart olmasın). Rolün kendi turu ilk sıradadır.
 */
async function TourPickerSection({ tenantId, role, perms }: { tenantId: string | null; role: string; perms: EffectivePermissions }) {
  const supabase = await createClient();
  const [content, planRow, closed] = await Promise.all([
    loadOnboardingContent(),
    tenantId
      ? supabase
          .from("tenants")
          .select("plan")
          .eq("id", tenantId)
          .maybeSingle()
          .then((r) => r.data as { plan?: string | null } | null, () => null)
      : Promise.resolve(null),
    getClosedFeatures(tenantId).catch(() => [] as string[]),
  ]);
  const accessible = (Object.keys(perms) as AppModule[]).filter((m) => effectiveHasPermission(perms, m, "view"));
  const ctx = { accessible, closed, role, can: (m: AppModule, a: AppAction) => effectiveHasPermission(perms, m, a) };
  const tours = listableTours(ctx, resolveTours(content, { role, plan: planRow?.plan ?? null })).map((t) => ({
    id: t.id,
    label: t.label,
    description: t.description,
  }));
  if (tours.length === 0) return null;
  return <TourPicker tours={tours} />;
}
