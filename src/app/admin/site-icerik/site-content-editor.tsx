"use client";

import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, History, Loader2, RotateCcw, Save, Send, Undo2 } from "lucide-react";
import { discardSiteContentDraft, publishSiteContent, resetSiteContentToDefault, rollbackSiteContent, saveSiteContentDraft } from "@/app/actions/site-content";
import { acknowledgeHeroBudget } from "@/app/actions/site-media";
import { kb, SITE_MEDIA_LIMITS } from "@/lib/site-media/quota";
import { Input } from "@/components/ui/input";
import { PIONEER_CLAIM } from "@/lib/site-content/claims";
import { CONTENT_TOKENS, LIMITS, SECTION_KEYS, TOKEN_HELP, firstSentence, hasErrors, newCardId, sameContent, type SectionKey } from "@/lib/site-content/schema-core";
import type { LookTextItem, SiteContent, validateSiteContent } from "@/lib/site-content/schema";
import type { PlanDef } from "@/lib/billing/plans";

import { InlineConfirm, TargetDatalist } from "../site-menu/editor-ui";
import { Card, CtaFields, Full, ListShell, Txt, nextId, type Update } from "./editor-fields";
import { ContentPreview } from "./content-preview";
import { LookFields, PortalStripCard, TestimonialsTab, setOpt } from "./editor-look";
import { RealPreview, type RealPreviewHandle } from "./real-preview";
import { cmsFieldSelectors, cmsTabFor, type EditorTab } from "./cms-bridge";
import { MediaPicker, type MediaLibraryState, type PickerMedia } from "./media-picker";
import { BentoTab, EfTab, LayoutTab, TourTab, WhyTab, setValuationVisible, valuationVisible } from "./editor-landing-tabs";

type Tab = EditorTab;
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "layout", label: "Bölüm düzeni" },
  { id: "hero", label: "Ana başlık" },
  { id: "sections", label: "Bölüm başlıkları" },
  { id: "lists", label: "Kartlar ve listeler" },
  { id: "tour", label: "Ürün turu" },
  { id: "bento", label: "Özellik ızgarası" },
  { id: "why", label: "Karşılaştırma" },
  { id: "valuation", label: "Değerleme" },
  { id: "ef", label: "EmlakFiyati analiz bakiyesi" },
  { id: "faq", label: "SSS" },
  { id: "testimonials", label: "Müşteri yorumları" },
  { id: "final", label: "Son çağrı" },
  { id: "pages", label: "Demo ve kayıt" },
  { id: "versions", label: "Sürümler" },
];

const SECTION_META: Record<SectionKey, { label: string; hasText: boolean }> = {
  tur: { label: "Ürün turu", hasText: true },
  ozellikler: { label: "Ürün (özellik ızgarası)", hasText: true },
  diger: { label: "Ayrıntılar", hasText: true },
  neden: { label: "Neden EmlakSoft", hasText: true },
  nasil: { label: "Nasıl çalışır", hasText: false },
  fiyat: { label: "Fiyat bölümü (yalnız başlık metni)", hasText: true },
  sss: { label: "Sık sorulan sorular", hasText: false },
  guvenlik: { label: "Güvenlik ve KVKK", hasText: false },
};

export type HistoryView = { id: string; atLabel: string; by: string; label: string; faq: number; isLive: boolean };

/** Önizleme bağlamı (sunucudan): gerçek deneme günü/paketler ve imzalı önizleme bağlantısı ayarları. */
export type PreviewContext = { trialDays?: number; plans: readonly PlanDef[]; enabled: boolean; ttlOptions: readonly number[]; defaultTtl: number };

type Props = { initialDraft: SiteContent; live: SiteContent | null; defaults: SiteContent; history: HistoryView[]; canWrite: boolean; preview: PreviewContext; media: MediaLibraryState };

export function SiteContentEditor({ initialDraft, live, defaults, history, canWrite, preview, media }: Props) {
  const router = useRouter();
  const readOnly = !canWrite;
  const [cfg, setCfg] = useState<SiteContent>(initialDraft);
  const [saved, setSaved] = useState<SiteContent>(initialDraft);
  const [tab, setTab] = useState<Tab>("layout");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const previewRef = useRef<RealPreviewHandle>(null);
  // Yerinde düzenleme: önizlemede tıklanan yol (sekme açılır, alan odaklanır).
  const [focusPath, setFocusPath] = useState<string | null>(null);
  // Bu oturumda yüklenen görseller (sunucu listesi yenilenene kadar seçicide görünsün).
  const [uploaded, setUploaded] = useState<PickerMedia[]>([]);
  const library: MediaLibraryState = useMemo(
    () => ({ status: media.status, items: [...uploaded.filter((u) => !media.items.some((m) => m.id === u.id)), ...media.items] }),
    [media, uploaded],
  );
  // Kalite kapısı: ilk ekran bütçesini aşan hero görseli "Yine de kaydet" + gerekçe ister (yalnız bu yüzey).
  const [gate, setGate] = useState<{ action: () => void; reason: string } | null>(null);
  const [ackedFor, setAckedFor] = useState<string | null>(null);

  // Canlı doğrulama zod gerektirir: ayrı parça, boşta yüklenir (sunucu kaydederken yine doğrular).
  const [validate, setValidate] = useState<typeof validateSiteContent | null>(null);
  useEffect(() => {
    let alive = true;
    void import("@/lib/site-content/schema").then((m) => {
      if (alive) setValidate(() => m.validateSiteContent);
    });
    return () => {
      alive = false;
    };
  }, []);
  const issues = useMemo(() => (validate ? validate(cfg).issues : []), [validate, cfg]);
  const errorCount = issues.filter((i) => i.level === "error").length;
  const warnCount = issues.length - errorCount;
  const blocked = !validate || hasErrors(issues);
  const dirty = !sameContent(cfg, saved);
  const liveCfg = live ?? defaults;
  const pendingPublish = !sameContent(saved, liveCfg);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update: Update = useCallback((fn) => {
    setCfg((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setMsg(null);
  }, []);

  useEffect(() => {
    if (!focusPath) return;
    const raf = requestAnimationFrame(() => {
      const [exact, under] = cmsFieldSelectors(focusPath);
      const el = document.querySelector<HTMLElement>(exact) ?? document.querySelector<HTMLElement>(under) ?? document.getElementById(`sc-panel-${tab}`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus({ preventScroll: true });
      setFocusPath(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [focusPath, tab]);

  const onCmsSelect = useCallback((path: string) => {
    const t = cmsTabFor(path);
    if (!t) return;
    setTab(t);
    setFocusPath(path);
  }, []);

  const heroMedia = cfg.hero.image ? library.items.find((m) => m.id === cfg.hero.image!.mediaId) : undefined;
  const needsBudgetAck = Boolean(heroMedia?.heroOver && saved.hero.image?.mediaId !== heroMedia.id && ackedFor !== heroMedia.id);
  /** Bütçe aşımı varsa önce gerekçe paneli; yoksa doğrudan. */
  const guarded = (action: () => void) => (needsBudgetAck ? setGate({ action, reason: "" }) : action());
  const confirmGate = () => {
    if (!gate || !heroMedia) return;
    const { action, reason } = gate;
    start(async () => {
      const res = await acknowledgeHeroBudget(heroMedia.id, reason);
      if (res.error) {
        setMsg({ kind: "error", text: res.error });
        return;
      }
      setAckedFor(heroMedia.id);
      setGate(null);
      action();
    });
  };

  const run = (job: () => Promise<{ ok?: boolean; error?: string; config?: SiteContent }>, okText: string, after?: (c?: SiteContent) => void) => {
    setMsg(null);
    start(async () => {
      const res = await job();
      if (res.error) {
        setMsg({ kind: "error", text: res.error });
        return;
      }
      after?.(res.config);
      setMsg({ kind: "ok", text: okText });
      router.refresh();
      // Kayıtlı taslak değişti: açık gerçek önizleme yeni bağlantıyla yenilenir (eski bağlantı geçersiz olur).
      previewRef.current?.refresh();
    });
  };
  const adopt = (c?: SiteContent) => {
    if (c) {
      setCfg(c);
      setSaved(c);
    }
  };

  const saveDraft = () =>
    run(() => saveSiteContentDraft(cfg), "Taslak kaydedildi. Henüz canlı değil.", (c) => {
      const next = c ?? cfg;
      setSaved(next);
      setCfg((cur) => (sameContent(cur, cfg) ? next : cur));
    });
  const publish = () =>
    run(
      async () => {
        if (dirty) {
          const s = await saveSiteContentDraft(cfg);
          if (s.error) return s;
          if (s.config) setSaved(s.config);
        }
        return publishSiteContent(note);
      },
      "Yayınlandı. Ana sayfa birkaç saniye içinde yenilenir.",
      () => {
        setNote("");
        setSaved(cfg);
      },
    );

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    setTab(TABS[n]!.id);
    tabRefs.current[n]?.focus();
  };

  const props = { cfg, update, issues, readOnly };

  return (
    <div className="space-y-5">
      <TargetDatalist />
      {readOnly ? (
        <p role="status" className="rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Bu ekran sizin rolünüz için salt okunurdur; yalnız süper admin değiştirebilir.
        </p>
      ) : null}
      <p className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-sm text-text-muted">
        Fiyatlar buradan değil, <Link href="/admin/billing/planlar" className="font-semibold text-brand-700 underline">Plan editöründen</Link> yönetilir; arama motoru başlık ve açıklamaları{" "}
        <Link href="/admin/seo" className="font-semibold text-brand-700 underline">SEO merkezinden</Link>. Metinlerde değişken kullanabilirsiniz:{" "}
        {CONTENT_TOKENS.map((t) => (
          <code key={t} title={TOKEN_HELP[t]} className="mr-1 rounded bg-ink-950/6 px-1 py-0.5 text-xs">{`{${t}}`}</code>
        ))}
        (imleci üzerine getirince anlamı görünür). Yalnız düz metin girilir; HTML kullanılamaz, satır sonu desteklenir.
      </p>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-label="Taslak ve yayın">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${live ? "bg-brand-600/10 text-brand-700" : "bg-ink-950/6 text-text-muted"}`}>Canlı: {live ? "Özel yayın" : "Varsayılan (bugünkü metin)"}</span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${dirty ? "bg-amber-100 text-amber-900" : pendingPublish ? "bg-brand-600/10 text-brand-700" : "bg-mint-500/15 text-mint-700"}`}>
            {dirty ? "Kaydedilmemiş değişiklik var" : pendingPublish ? "Taslak kayıtlı, yayınlanmadı" : "Taslak canlıyla aynı"}
          </span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${errorCount ? "bg-danger-500/12 text-danger-600" : "bg-ink-950/6 text-text-muted"}`}>{errorCount} hata · {warnCount} uyarı</span>
        </div>
        {!readOnly ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Button type="button" variant="outline" size="sm" disabled={pending || !dirty || blocked} onClick={() => guarded(saveDraft)}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />} Taslağı kaydet
            </Button>
            <label className="min-w-[10rem] flex-1 sm:max-w-xs">
              <span className="sr-only">Sürüm notu</span>
              <Input placeholder="Sürüm notu (isteğe bağlı)" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} />
            </label>
            <InlineConfirm label="Yayınla" confirmLabel="Evet, canlıya al" disabled={pending || blocked || (!dirty && !pendingPublish)} icon={<Send className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={() => guarded(publish)} />
            <InlineConfirm
              label="Taslağı bırak"
              confirmLabel="Evet, bırak"
              tone="danger"
              disabled={pending || (!dirty && !pendingPublish)}
              icon={<Undo2 className="h-3.5 w-3.5" aria-hidden="true" />}
              onConfirm={() => run(discardSiteContentDraft, "Taslak bırakıldı; canlı içerikle eşitlendi.", adopt)}
            />
            <InlineConfirm
              label="Varsayılana dön"
              confirmLabel="Evet, sıfırla"
              tone="danger"
              disabled={pending}
              icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
              onConfirm={() => run(resetSiteContentToDefault, "Varsayılana dönüldü; site bugünkü metinle çalışıyor.", adopt)}
            />
          </div>
        ) : null}
        {blocked ? <p className="mt-2 text-xs font-semibold text-danger-500">Hatalar düzelmeden taslak kaydedilemez ve yayınlanamaz.</p> : null}
        {gate && heroMedia ? (
          <div role="alertdialog" aria-label="İlk ekran bütçesi aşıldı" className="mt-3 rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 p-3">
            <p className="flex items-start gap-1.5 text-xs font-bold text-amber-900">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Ana başlık görseli ilk ekran bütçesini aşıyor: 960 px AVIF {kb(heroMedia.heroBytes)} (sınır {kb(SITE_MEDIA_LIMITS.heroBudgetBytes)}). Sayfanın ilk açılışı yavaşlar. Daha küçük bir görsel seçin ya da gerekçe yazıp yine de kaydedin.
            </p>
            <label className="mt-2 block text-xs font-semibold text-amber-900">
              Gerekçe (denetim kaydına yazılır)
              <Input className="mt-1" value={gate.reason} maxLength={300} onChange={(e) => setGate({ ...gate, reason: e.target.value })} placeholder="ör. Kampanya görseli, bir hafta yayında kalacak" />
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="primary" disabled={pending || gate.reason.trim().length < 5} onClick={confirmGate}>Yine de kaydet</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setGate(null)}>Vazgeç</Button>
            </div>
          </div>
        ) : null}
        {msg ? (
          <p role={msg.kind === "error" ? "alert" : "status"} className={`mt-2 flex items-center gap-1.5 text-xs font-semibold ${msg.kind === "error" ? "text-danger-500" : "text-mint-700"}`}>
            {msg.kind === "error" ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
            {msg.text}
          </p>
        ) : null}
      </section>

      <RealPreview ref={previewRef} enabled={preview.enabled} dirty={dirty} ttlOptions={preview.ttlOptions} defaultTtl={preview.defaultTtl} onSelect={onCmsSelect} />

      <ContentPreview cfg={cfg} trialDays={preview.trialDays} plans={preview.plans} />

      <div role="tablist" aria-label="Site içeriği bölümleri" className="flex flex-wrap gap-1.5 border-b border-line pb-2">
        {TABS.map((t, i) => (
          <Button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`sc-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`sc-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            type="button"
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={`focus-ring rounded-[var(--radius-control)] px-3.5 py-2 text-sm font-bold transition ${tab === t.id ? "bg-brand-600 text-white" : "text-text-muted hover:text-ink-950"}`}
          >
            {t.label}
          </Button>
        ))}
      </div>

      <div role="tabpanel" id={`sc-panel-${tab}`} aria-labelledby={`sc-tab-${tab}`} tabIndex={0} className="focus-ring space-y-4 rounded-[var(--radius-card)]">
        {tab === "layout" ? <LayoutTab {...props} /> : null}
        {tab === "hero" ? <HeroTab {...props} library={library} onUploaded={(m) => setUploaded((list) => [m, ...list])} /> : null}
        {tab === "sections" ? <SectionsTab {...props} /> : null}
        {tab === "lists" ? <ListsTab {...props} /> : null}
        {tab === "tour" ? <TourTab {...props} /> : null}
        {tab === "bento" ? <BentoTab {...props} /> : null}
        {tab === "why" ? <WhyTab {...props} /> : null}
        {tab === "valuation" ? <ValuationTab {...props} /> : null}
        {tab === "ef" ? <EfTab {...props} /> : null}
        {tab === "faq" ? <FaqTab {...props} /> : null}
        {tab === "testimonials" ? <TestimonialsTab {...props} /> : null}
        {tab === "final" ? <FinalTab {...props} /> : null}
        {tab === "pages" ? <PagesTab {...props} /> : null}
        {tab === "versions" ? (
          <section className="space-y-3" aria-label="Sürüm geçmişi">
            <p className="text-xs text-text-muted">Her yayın bir sürüm olarak saklanır (son 10). Bir sürüme dönmek onu yeni bir sürüm olarak canlıya alır; hiçbir kayıt silinmez.</p>
            {history.length === 0 ? (
              <p className="rounded-[var(--radius-card)] border border-dashed border-line p-6 text-center text-sm text-text-muted">Henüz yayın yapılmadı; site bugünkü varsayılan metinle çalışıyor.</p>
            ) : (
              <ol className="space-y-2">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-bold text-ink-950">
                        <History className="h-4 w-4 text-text-faint" aria-hidden="true" />
                        <span className="truncate">{h.label}</span>
                        {h.isLive ? <span className="rounded-full bg-mint-500/15 px-2 py-0.5 text-xs font-bold text-mint-700">Canlı</span> : null}
                      </p>
                      <p className="text-xs text-text-muted">{h.atLabel} · {h.by || "—"} · {h.faq} soru</p>
                    </div>
                    {!readOnly ? (
                      <InlineConfirm label="Bu sürüme dön" confirmLabel="Evet, canlıya al" disabled={pending} icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={() => run(() => rollbackSiteContent(h.id), "Seçilen sürüm canlıya alındı.", adopt)} />
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}
      </div>

      {issues.length ? (
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-label="Doğrulama sonuçları">
          <h2 className="font-display text-base font-extrabold text-ink-950">Doğrulama</h2>
          <ul className="mt-2 space-y-1.5">
            {issues.slice(0, 40).map((i, n) => (
              <li key={`${i.path}-${n}`} className={`flex items-start gap-1.5 text-xs font-semibold ${i.level === "error" ? "text-danger-500" : "text-amber-700"}`}>
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span><span className="uppercase tracking-wide">{i.level === "error" ? "Hata" : "Uyarı"}</span> · {i.path ? `${i.path}: ` : ""}{i.message}</span>
              </li>
            ))}
            {issues.length > 40 ? <li className="text-xs text-text-muted">… ve {issues.length - 40} sorun daha.</li> : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

type TabProps = { cfg: SiteContent; update: Update; issues: ReturnType<typeof validateSiteContent>["issues"]; readOnly: boolean };

function HeroTab({ cfg, update, issues, readOnly, library, onUploaded }: TabProps & { library: MediaLibraryState; onUploaded: (m: PickerMedia) => void }) {
  const h = cfg.hero;
  const f = { issues, readOnly };
  return (
    <>
      <MediaPicker
        value={h.image}
        library={library}
        onUploaded={onUploaded}
        readOnly={readOnly}
        issues={issues}
        onChange={(v) =>
          update((d) => {
            if (v) d.hero.image = v;
            else delete d.hero.image;
          })
        }
      />
      <Card title="Ana başlık (hero)">
        <Txt label="Rozet" value={h.badge} max={LIMITS.badge} onChange={(v) => update((d) => void (d.hero.badge = v))} path="hero.badge" {...f} />
        <Full>
          <div className="grid gap-3 sm:grid-cols-3">
            <Txt label="Başlık (başı)" value={h.title} max={LIMITS.title} onChange={(v) => update((d) => void (d.hero.title = v))} path="hero.title" {...f} />
            <Txt label="Vurgulu kısım" value={h.em} max={LIMITS.em} onChange={(v) => update((d) => void (d.hero.em = v))} path="hero.em" {...f} />
            <Txt label="Başlık (sonu)" value={h.tail} max={LIMITS.tail} onChange={(v) => update((d) => void (d.hero.tail = v))} path="hero.tail" {...f} />
          </div>
        </Full>
        <Full><Txt label="Açıklama" multiline value={h.lead} max={LIMITS.lead} onChange={(v) => update((d) => void (d.hero.lead = v))} path="hero.lead" {...f} /></Full>
        <Full>
          <Txt
            label="Mobil açıklama (tek cümle)"
            value={h.mobileLead}
            max={LIMITS.mobileLead}
            onChange={(v) => update((d) => void (d.hero.mobileLead = v))}
            path="hero.mobileLead"
            hint={`Telefonda uzun açıklamanın yerine görünür; en fazla iki satır kalacak kısa bir cümle yazın. Boşsa: “${firstSentence(h.lead)}”`}
            {...f}
          />
        </Full>
        <CtaFields label="Ana düğme" value={h.primary} onChange={(v) => update((d) => void (d.hero.primary = v))} path="hero.primary" {...f} />
        <CtaFields label="İkinci düğme" value={h.secondary} onChange={(v) => update((d) => void (d.hero.secondary = v))} path="hero.secondary" {...f} />
        <Txt label="EmlakFiyati rozeti (boşsa gösterilmez)" value={h.integrationBadge} max={LIMITS.badge} onChange={(v) => update((d) => void (d.hero.integrationBadge = v))} path="hero.integrationBadge" {...f} />
        <Txt label="EmlakFiyati vurgu satırı (boşsa gösterilmez)" value={h.integrationLine} max={240} onChange={(v) => update((d) => void (d.hero.integrationLine = v))} path="hero.integrationLine" {...f} />
      </Card>
      <ListShell
        title="Başlık altı maddeler"
        items={h.checks}
        setItems={(n) => update((d) => void (d.hero.checks = n))}
        readOnly={readOnly}
        summary={(c) => c.text}
        render={(c, i) => <Full><Txt label="Madde" value={c.text} max={LIMITS.cardText} onChange={(v) => update((d) => void (d.hero.checks[i]!.text = v))} path={`hero.checks.${i}.text`} {...f} /></Full>}
        onAdd={() => update((d) => void d.hero.checks.push({ id: nextId("c", d.hero.checks.map((x) => x.id)), text: "", hidden: false }))}
        max={LIMITS.maxChecks}
      />
      <PortalStripCard {...{ cfg, update, issues, readOnly }} />
    </>
  );
}

function SectionsTab({ cfg, update, issues, readOnly }: TabProps) {
  const f = { issues, readOnly };
  return (
    <>
      {SECTION_KEYS.map((k) => {
        const s = cfg.sections[k];
        const p = `sections.${k}`;
        return (
          <Card key={k} title={SECTION_META[k].label}>
            <Txt label="Üst başlık" value={s.eyebrow} max={LIMITS.eyebrow} onChange={(v) => update((d) => void (d.sections[k].eyebrow = v))} path={`${p}.eyebrow`} {...f} />
            <div className="hidden sm:block" />
            <Txt label="Başlık (başı)" value={s.title} max={LIMITS.title} onChange={(v) => update((d) => void (d.sections[k].title = v))} path={`${p}.title`} {...f} />
            <Txt label="Vurgulu kısım" value={s.em} max={LIMITS.em} onChange={(v) => update((d) => void (d.sections[k].em = v))} path={`${p}.em`} {...f} />
            <Txt label="Başlık (sonu)" value={s.tail} max={LIMITS.tail} onChange={(v) => update((d) => void (d.sections[k].tail = v))} path={`${p}.tail`} {...f} />
            {SECTION_META[k].hasText ? (
              <Full><Txt label="Açıklama" multiline value={s.text} max={LIMITS.lead} onChange={(v) => update((d) => void (d.sections[k].text = v))} path={`${p}.text`} {...f} /></Full>
            ) : null}
          </Card>
        );
      })}
    </>
  );
}

function ListsTab({ cfg, update, issues, readOnly }: TabProps) {
  const f = { issues, readOnly };
  return (
    <>
      <ListShell
        title="Değer kartları (hero altı)"
        items={cfg.valueCards}
        setItems={(n) => update((d) => void (d.valueCards = n))}
        readOnly={readOnly}
        summary={(c) => c.title}
        render={(c, i) => (
          <>
            <Txt label="Başlık" value={c.title} max={LIMITS.cardTitle} onChange={(v) => update((d) => void (d.valueCards[i]!.title = v))} path={`valueCards.${i}.title`} {...f} />
            <Txt label="Bağlantı" value={c.href} max={300} onChange={(v) => update((d) => void (d.valueCards[i]!.href = v))} path={`valueCards.${i}.href`} list="site-menu-targets" {...f} />
            <Full><Txt label="Açıklama" value={c.text} max={LIMITS.cardText} onChange={(v) => update((d) => void (d.valueCards[i]!.text = v))} path={`valueCards.${i}.text`} {...f} /></Full>
            <LookFields withTone icon={c.icon} tone={c.tone} readOnly={readOnly} onIcon={(v) => update((d) => setOpt(d.valueCards[i]!, "icon", v))} onTone={(v) => update((d) => setOpt(d.valueCards[i]!, "tone", v))} />
          </>
        )}
        onAdd={() => update((d) => void d.valueCards.push({ id: newCardId(d.valueCards.map((x) => x.id)), title: "", text: "", href: "/kayit", hidden: false }))}
        addLabel="Kart ekle"
        max={LIMITS.maxCards}
      />
      <ListShell
        title="Güven şeridi (değerler koddan gelir: sahte sayaç yok; eklenen öğe yalnız ikon ve etiketle, sayısız görünür)"
        items={cfg.trust}
        setItems={(n) => update((d) => void (d.trust = n))}
        readOnly={readOnly}
        summary={(c) => c.label}
        render={(c, i) => (
          <>
            <Txt label="Etiket" value={c.label} max={LIMITS.cardTitle} onChange={(v) => update((d) => void (d.trust[i]!.label = v))} path={`trust.${i}.label`} {...f} />
            <Txt label="Bağlantı" value={c.href} max={300} onChange={(v) => update((d) => void (d.trust[i]!.href = v))} path={`trust.${i}.href`} list="site-menu-targets" {...f} />
            <LookFields withTone={false} icon={c.icon} readOnly={readOnly} onIcon={(v) => update((d) => setOpt(d.trust[i]!, "icon", v))} onTone={() => undefined} />
          </>
        )}
        onAdd={() => update((d) => void d.trust.push({ id: newCardId(d.trust.map((x) => x.id)), label: "", href: "/#fiyat", hidden: false }))}
        addLabel="Öğe ekle"
        max={LIMITS.maxCards}
      />
      <TextItems title="Ayrıntılar (küçük büyük şeyler)" path="highlights" withTone items={cfg.highlights} set={(n) => update((d) => void (d.highlights = n))} update={update} get={(d) => d.highlights} {...f} />
      <TextItems title="Nasıl çalışır: adımlar" path="steps" items={cfg.steps} set={(n) => update((d) => void (d.steps = n))} update={update} get={(d) => d.steps} {...f} />
      <TextItems title="Güvenlik maddeleri" path="security.items" items={cfg.security.items} set={(n) => update((d) => void (d.security.items = n))} update={update} get={(d) => d.security.items} {...f} />
      <ListShell
        title="Güvenlik etiketleri"
        items={cfg.security.chips}
        setItems={(n) => update((d) => void (d.security.chips = n))}
        readOnly={readOnly}
        summary={(c) => c.text}
        render={(c, i) => <Full><Txt label="Etiket" value={c.text} max={LIMITS.chip} onChange={(v) => update((d) => void (d.security.chips[i]!.text = v))} path={`security.chips.${i}.text`} {...f} /></Full>}
        onAdd={() => update((d) => void d.security.chips.push({ id: nextId("e", d.security.chips.map((x) => x.id)), text: "", hidden: false }))}
        max={LIMITS.maxList}
      />
      <Card title="Güvenlik dipnotu">
        <Full><Txt label="Dipnot" multiline value={cfg.security.note} max={LIMITS.note} onChange={(v) => update((d) => void (d.security.note = v))} path="security.note" {...f} /></Full>
      </Card>
    </>
  );
}

/** Başlık + açıklama kartları; öğe eklenebilir (`c_...` kimlik), ikon (ve `withTone` ise renk tonu) seçilir. */
function TextItems({
  title,
  path,
  items,
  set,
  update,
  get,
  issues,
  readOnly,
  withTone = false,
}: {
  title: string;
  path: string;
  items: LookTextItem[];
  set: (n: LookTextItem[]) => void;
  update: Update;
  get: (d: SiteContent) => LookTextItem[];
  issues: TabProps["issues"];
  readOnly: boolean;
  withTone?: boolean;
}) {
  return (
    <ListShell
      title={title}
      items={items}
      setItems={set}
      readOnly={readOnly}
      summary={(c) => c.title}
      render={(c, i) => (
        <>
          <Full><Txt label="Başlık" value={c.title} max={LIMITS.title} onChange={(v) => update((d) => void (get(d)[i]!.title = v))} path={`${path}.${i}.title`} issues={issues} readOnly={readOnly} /></Full>
          <Full><Txt label="Açıklama" multiline value={c.text} max={LIMITS.text} onChange={(v) => update((d) => void (get(d)[i]!.text = v))} path={`${path}.${i}.text`} issues={issues} readOnly={readOnly} /></Full>
          <LookFields withTone={withTone} icon={c.icon} tone={c.tone} readOnly={readOnly} onIcon={(v) => update((d) => setOpt(get(d)[i]!, "icon", v))} onTone={(v) => update((d) => setOpt(get(d)[i]!, "tone", v))} />
        </>
      )}
      onAdd={() => update((d) => void get(d).push({ id: newCardId(get(d).map((x) => x.id)), title: "", text: "", hidden: false }))}
      addLabel="Kart ekle"
      max={LIMITS.maxCards}
    />
  );
}

function ValuationTab({ cfg, update, issues, readOnly }: TabProps) {
  const v = cfg.valuation;
  const f = { issues, readOnly };
  const check = (key: "before" | "after", title: string) => (
    <ListShell
      title={title}
      items={v.compare[key]}
      setItems={(n) => update((d) => void (d.valuation.compare[key] = n))}
      readOnly={readOnly}
      summary={(c) => c.text}
      render={(c, i) => <Full><Txt label="Madde" value={c.text} max={LIMITS.cardText} onChange={(x) => update((d) => void (d.valuation.compare[key][i]!.text = x))} path={`valuation.compare.${key}.${i}.text`} {...f} /></Full>}
      onAdd={() => update((d) => void d.valuation.compare[key].push({ id: nextId(key === "before" ? "b" : "a", d.valuation.compare[key].map((x) => x.id)), text: "", hidden: false }))}
      max={LIMITS.maxChecks}
    />
  );
  return (
    <>
      <Card
        title="Değerleme bölümü (EmlakFiyati entegrasyonu)"
        aside={
          <label className="flex items-center gap-2 text-xs font-semibold text-ink-950">
            <input type="checkbox" disabled={readOnly} checked={valuationVisible(cfg)} onChange={(e) => update((d) => setValuationVisible(d, e.target.checked))} />
            Bölümü ana sayfada göster
          </label>
        }
      >
        <Txt label="Üst başlık" value={v.eyebrow} max={LIMITS.eyebrow} onChange={(x) => update((d) => void (d.valuation.eyebrow = x))} path="valuation.eyebrow" {...f} />
        <div className="hidden sm:block" />
        <Txt label="Başlık (başı)" value={v.title} max={LIMITS.title} onChange={(x) => update((d) => void (d.valuation.title = x))} path="valuation.title" {...f} />
        <Txt label="Vurgulu kısım" value={v.em} max={LIMITS.em} onChange={(x) => update((d) => void (d.valuation.em = x))} path="valuation.em" {...f} />
        <Txt label="Başlık (sonu)" value={v.tail} max={LIMITS.tail} onChange={(x) => update((d) => void (d.valuation.tail = x))} path="valuation.tail" {...f} />
        <Full><Txt label="Açıklama" multiline value={v.text} max={LIMITS.lead} onChange={(x) => update((d) => void (d.valuation.text = x))} path="valuation.text" {...f} /></Full>
        <Full><Txt label="Somut tanım (her zaman gösterilir)" value={v.claimConcrete} max={200} onChange={(x) => update((d) => void (d.valuation.claimConcrete = x))} path="valuation.claimConcrete" {...f} /></Full>
        <Full>
          <div className="rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 p-3">
            <p role="note" className="flex items-start gap-1.5 text-xs font-bold text-amber-900">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {PIONEER_CLAIM.evidenceWarning}
            </p>
            <div className="mt-2 grid items-end gap-3 sm:grid-cols-[1fr_auto_auto]">
              <Txt label="“İlk ve tek” iddiası (ayrı cümle)" value={v.claim.text} max={80} onChange={(x) => update((d) => void (d.valuation.claim.text = x))} path="valuation.claim.text" {...f} />
              <label className="flex items-center gap-2 pb-2 text-xs font-semibold text-ink-950">
                <input type="checkbox" disabled={readOnly} checked={!v.claim.hidden} onChange={(e) => update((d) => void (d.valuation.claim.hidden = !e.target.checked))} />
                Göster
              </label>
              <Button type="button" variant="outline" size="sm" disabled={readOnly} onClick={() => update((d) => void (d.valuation.claim.text = PIONEER_CLAIM.text))}>Varsayılan metin</Button>
            </div>
          </div>
        </Full>
        <Txt label="Canlıyken rozet" value={v.liveBadge} max={30} onChange={(x) => update((d) => void (d.valuation.liveBadge = x))} path="valuation.liveBadge" {...f} />
        <Txt label="Canlı değilken rozet" value={v.soonBadge} max={30} onChange={(x) => update((d) => void (d.valuation.soonBadge = x))} path="valuation.soonBadge" {...f} />
        <CtaFields label="Canlıyken düğme" value={v.liveCta} onChange={(x) => update((d) => void (d.valuation.liveCta = x))} path="valuation.liveCta" {...f} />
        <CtaFields label="Canlı değilken düğme" value={v.soonCta} onChange={(x) => update((d) => void (d.valuation.soonCta = x))} path="valuation.soonCta" {...f} />
        <Full><Txt label="Dipnot (resmi ekspertiz uyarısı)" multiline value={v.note} max={LIMITS.note} onChange={(x) => update((d) => void (d.valuation.note = x))} path="valuation.note" {...f} /></Full>
        <Full>
          <p className="text-xs text-text-muted">Canlı/Yakında durumu bu editörden değil, EmlakFiyati ortak bayrağı ve son yoklamadan otomatik okunur; özellik canlı değilken “şimdi deneyin” denmez.</p>
        </Full>
      </Card>
      <ListShell
        title="Özellik kartları (aylık hak satırı, plan tanımında alan yoksa otomatik gizlenir)"
        items={v.points}
        setItems={(n) => update((d) => void (d.valuation.points = n))}
        readOnly={readOnly}
        summary={(c) => c.title}
        render={(c, i) => (
          <>
            <Full><Txt label="Başlık" value={c.title} max={LIMITS.title} onChange={(x) => update((d) => void (d.valuation.points[i]!.title = x))} path={`valuation.points.${i}.title`} {...f} /></Full>
            <Full><Txt label="Açıklama" multiline value={c.text} max={LIMITS.text} onChange={(x) => update((d) => void (d.valuation.points[i]!.text = x))} path={`valuation.points.${i}.text`} {...f} /></Full>
          </>
        )}
      />
      <Card title="Önce / sonra karşılaştırması (rakip adı yazmayın)">
        <Txt label="“Önce” başlığı" value={v.compare.beforeTitle} max={LIMITS.cardTitle} onChange={(x) => update((d) => void (d.valuation.compare.beforeTitle = x))} path="valuation.compare.beforeTitle" {...f} />
        <Txt label="“Sonra” başlığı" value={v.compare.afterTitle} max={LIMITS.cardTitle} onChange={(x) => update((d) => void (d.valuation.compare.afterTitle = x))} path="valuation.compare.afterTitle" {...f} />
      </Card>
      {check("before", "“Önce” maddeleri")}
      {check("after", "“Sonra” maddeleri")}
    </>
  );
}

function FaqTab({ cfg, update, issues, readOnly }: TabProps) {
  const f = { issues, readOnly };
  return (
    <>
      <p className="text-xs text-text-muted">Görünen sorular ve sayfadaki FAQPage yapılandırılmış verisi (JSON-LD) AYNI listeden üretilir; gizlediğiniz soru ikisinden de çıkar.</p>
      <ListShell
        title={`Sorular (${cfg.faq.length}/${LIMITS.maxFaq})`}
        items={cfg.faq}
        setItems={(n) => update((d) => void (d.faq = n))}
        readOnly={readOnly}
        summary={(c) => c.q}
        render={(c, i) => (
          <>
            <Full><Txt label="Soru" value={c.q} max={LIMITS.question} onChange={(x) => update((d) => void (d.faq[i]!.q = x))} path={`faq.${i}.q`} {...f} /></Full>
            <Full><Txt label="Cevap" multiline value={c.a} max={LIMITS.answer} onChange={(x) => update((d) => void (d.faq[i]!.a = x))} path={`faq.${i}.a`} {...f} /></Full>
          </>
        )}
        onAdd={() => update((d) => void d.faq.push({ id: nextId("f", d.faq.map((x) => x.id)), q: "", a: "", hidden: false }))}
        addLabel="Soru ekle"
        max={LIMITS.maxFaq}
      />
    </>
  );
}

function FinalTab({ cfg, update, issues, readOnly }: TabProps) {
  const c = cfg.finalCta;
  const f = { issues, readOnly };
  return (
    <>
      <Card title="Son çağrı">
        <Full>
          <div className="grid gap-3 sm:grid-cols-3">
            <Txt label="Başlık (başı)" value={c.title} max={LIMITS.title} onChange={(v) => update((d) => void (d.finalCta.title = v))} path="finalCta.title" {...f} />
            <Txt label="Vurgulu kısım" value={c.em} max={LIMITS.em} onChange={(v) => update((d) => void (d.finalCta.em = v))} path="finalCta.em" {...f} />
            <Txt label="Başlık (sonu)" value={c.tail} max={LIMITS.tail} onChange={(v) => update((d) => void (d.finalCta.tail = v))} path="finalCta.tail" {...f} />
          </div>
        </Full>
        <Full><Txt label="Açıklama" multiline value={c.text} max={LIMITS.lead} onChange={(v) => update((d) => void (d.finalCta.text = v))} path="finalCta.text" {...f} /></Full>
        <CtaFields label="Ana düğme" value={c.primary} onChange={(v) => update((d) => void (d.finalCta.primary = v))} path="finalCta.primary" {...f} />
        <CtaFields label="İkinci düğme" value={c.secondary} onChange={(v) => update((d) => void (d.finalCta.secondary = v))} path="finalCta.secondary" {...f} />
      </Card>
      <ListShell
        title="Alt maddeler ({yillik} geçen madde, yıllık teklif yokken otomatik gizlenir)"
        items={c.checks}
        setItems={(n) => update((d) => void (d.finalCta.checks = n))}
        readOnly={readOnly}
        summary={(x) => x.text}
        render={(x, i) => <Full><Txt label="Madde" value={x.text} max={LIMITS.cardText} onChange={(v) => update((d) => void (d.finalCta.checks[i]!.text = v))} path={`finalCta.checks.${i}.text`} {...f} /></Full>}
        onAdd={() => update((d) => void d.finalCta.checks.push({ id: nextId("m", d.finalCta.checks.map((y) => y.id)), text: "", hidden: false }))}
        max={LIMITS.maxChecks}
      />
    </>
  );
}

function PagesTab({ cfg, update, issues, readOnly }: TabProps) {
  const f = { issues, readOnly };
  return (
    <>
      {/* `demo` içerik anahtarı şemada geriye dönük durur; /demo sayfası kaldırıldı (kalıcı olarak /kayit'a yönlenir), bu yüzden düzenleyici kartı yok. */}
      <Card title="Kayıt sayfası (/kayit) üst metni">
        <Txt label="Başlık" value={cfg.register.title} max={LIMITS.title} onChange={(v) => update((d) => void (d.register.title = v))} path="register.title" {...f} />
        <Txt label="Alt metin" value={cfg.register.text} max={LIMITS.text} onChange={(v) => update((d) => void (d.register.text = v))} path="register.text" {...f} />
        <Full><Txt label="Yan panel metni" multiline value={cfg.register.panelText} max={LIMITS.lead} onChange={(v) => update((d) => void (d.register.panelText = v))} path="register.panelText" {...f} /></Full>
      </Card>
    </>
  );
}
