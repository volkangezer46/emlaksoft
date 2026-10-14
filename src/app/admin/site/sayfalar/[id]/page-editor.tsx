"use client";

import { useCallback, useEffect, useId, useMemo, useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowUp, Copy, Eye, History, Plus, Send, Trash2, Undo2, Archive, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { publishSitePage, rollbackSitePage, saveSitePageDraft, unpublishSitePage } from "@/app/actions/site-pages";
import { Card, Full, Txt } from "@/app/admin/site/sayfalar/ana-sayfa/editor-fields";
import { InlineConfirm, TargetDatalist } from "@/app/admin/site/menu/editor-ui";
import { SerpPreview } from "@/app/admin/site/seo/seo-ui";
import { MENU_ICON_LIST } from "@/lib/site-menu/icon-registry";
import { moveInArray } from "@/lib/site-menu/editor-model";
import type { Issue } from "@/lib/site-menu/schema-core";
import {
  BLOCK_LABEL,
  BLOCK_TYPES,
  PAGE_LIMITS as L,
  PAGE_STATUS_LABEL,
  emptyBlock,
  samePage,
  suggestSeo,
  type BlockType,
  type PageBlock,
  type PageLink,
  type SitePageContent,
  type SitePageIndexEntry,
} from "@/lib/site-pages/schema-core";
import type { validateSitePage } from "@/lib/site-pages/schema";

export type PageHistoryView = { id: string; atLabel: string; by: string; label: string; isLive: boolean };

type Props = {
  id: string;
  entry: SitePageIndexEntry;
  initialDraft: SitePageContent;
  live: SitePageContent | null;
  history: PageHistoryView[];
  canWrite: boolean;
  baseUrl: string;
  titleTemplate: string;
  hasRedirect: boolean;
  otherPaths: string[];
};

type Update = (fn: (draft: SitePageContent) => void) => void;

const hasErrors = (issues: readonly Issue[]) => issues.some((i) => i.level === "error");

export function SitePageEditor({ id, entry, initialDraft, live, history, canWrite, baseUrl, titleTemplate, hasRedirect, otherPaths }: Props) {
  const router = useRouter();
  const readOnly = !canWrite;
  const [cfg, setCfg] = useState<SitePageContent>(initialDraft);
  const [saved, setSaved] = useState<SitePageContent>(initialDraft);
  const [slug, setSlug] = useState(entry.slug);
  const [note, setNote] = useState("");
  const [addType, setAddType] = useState<BlockType>("text");
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  const [pending, start] = useTransition();
  const published = entry.status === "yayinda";

  // Canlı doğrulama zod gerektirir: ayrı parça, boşta yüklenir (sunucu kaydederken yine doğrular).
  const [validate, setValidate] = useState<typeof validateSitePage | null>(null);
  useEffect(() => {
    let alive = true;
    void import("@/lib/site-pages/schema").then((m) => {
      if (alive) setValidate(() => m.validateSitePage);
    });
    return () => {
      alive = false;
    };
  }, []);
  const issues = useMemo(() => (validate ? validate(cfg, { extraPaths: otherPaths }).issues : serverIssues), [validate, cfg, otherPaths, serverIssues]);
  const errorCount = issues.filter((i) => i.level === "error").length;
  const warnCount = issues.length - errorCount;
  const blocked = !validate || hasErrors(issues);
  const dirty = !samePage(cfg, saved) || slug.trim() !== entry.slug;
  const pendingPublish = !published || !samePage(saved, live);

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

  const run = (job: () => Promise<{ ok?: boolean; error?: string; issues?: Issue[]; notice?: string }>, okText: string, after?: () => void) => {
    setMsg(null);
    start(async () => {
      const res = await job();
      if (res.issues) setServerIssues(res.issues);
      if (res.error) {
        setMsg({ kind: "error", text: res.error });
        return;
      }
      after?.();
      setMsg(res.notice ? { kind: "warn", text: `${okText} ${res.notice}` } : { kind: "ok", text: okText });
      router.refresh();
    });
  };

  const saveDraft = () => run(() => saveSitePageDraft(id, cfg, slug), "Taslak kaydedildi. Henüz canlı değil.", () => setSaved(cfg));
  const publish = () =>
    run(
      async () => {
        if (dirty) {
          const s = await saveSitePageDraft(id, cfg, slug);
          if (s.error) return s;
        }
        return publishSitePage(id, note);
      },
      "Yayınlandı. Sayfa birkaç saniye içinde canlıda.",
      () => {
        setNote("");
        setSaved(cfg);
      },
    );
  const unpublish = () => run(() => unpublishSitePage(id), "Yayından kaldırıldı; bu yol artık 404 döner.");
  const rollback = (versionId: string) => run(() => rollbackSitePage(id, versionId), "Seçilen sürüm yayına alındı.");

  const setBlocks = (blocks: PageBlock[]) => update((d) => void (d.blocks = blocks));
  const suggested = suggestSeo(cfg);
  const seoTitle = cfg.seo.title || suggested.title;
  const seoDesc = cfg.seo.description || suggested.description;

  return (
    <div className="space-y-5">
      <TargetDatalist />

      {readOnly ? <Banner tone="info">Bu hesap salt okunur; sayfaları yalnız süper admin değiştirebilir.</Banner> : null}
      {hasRedirect ? (
        <Banner tone="warn">
          Bu yolda yönlendirme var; yönlendirme önceliklidir. Sayfanın görünmesi için <Link href="/admin/site/seo?sekme=yonlendirme" className="font-semibold underline">yönlendirme kuralını</Link> kapatın.
        </Banner>
      ) : null}

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
        <div className="flex flex-wrap items-end gap-3">
          <SlugField value={slug} onChange={setSlug} locked={published || readOnly} />
          <span className="inline-flex items-center rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-700">{PAGE_STATUS_LABEL[entry.status]}</span>
          {published ? (
            <a href={`/${entry.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">
              Canlıda aç
            </a>
          ) : null}
          <Link href={`/admin/site/sayfalar/${id}/onizleme`} target="_blank" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
            <Eye className="h-4 w-4" aria-hidden="true" /> Önizle (kayıtlı taslak)
          </Link>
        </div>
        {!readOnly ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={saveDraft} loading={pending} disabled={blocked || !dirty}>
              <Save className="h-4 w-4" aria-hidden="true" /> Taslağı kaydet
            </Button>
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} placeholder="Yayın notu (isteğe bağlı)" aria-label="Yayın notu" className="w-56" />
            <Button type="button" onClick={publish} loading={pending} disabled={blocked || (!dirty && !pendingPublish)}>
              <Send className="h-4 w-4" aria-hidden="true" /> Yayınla
            </Button>
            {published ? <InlineConfirm label="Yayından kaldır (arşiv)" confirmLabel="Kaldır" tone="danger" icon={<Archive className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={unpublish} disabled={pending} /> : null}
            {entry.status === "arsiv" ? (
              <Link href="/admin/site/seo?sekme=yonlendirme" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">
                Bu yol için yönlendirme ekle
              </Link>
            ) : null}
          </div>
        ) : null}
        <p className="mt-3 text-xs text-text-muted" role="status">
          {!validate ? "Doğrulayıcı yükleniyor…" : errorCount ? `${errorCount} hata düzeltilmeden kaydedilemez.` : "Hata yok."}
          {warnCount ? ` ${warnCount} uyarı (engellemez).` : ""}
          {dirty ? " Kaydedilmemiş değişiklik var." : ""}
        </p>
        {msg ? (
          <p role={msg.kind === "error" ? "alert" : "status"} className={`mt-2 rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium ${msg.kind === "error" ? "bg-danger-500/8 text-danger-600" : msg.kind === "warn" ? "bg-amber-50 text-amber-900" : "bg-mint-500/10 text-mint-700"}`}>
            {msg.text}
          </p>
        ) : null}
      </section>

      <Card title="Sayfa">
        <Full>
          <Txt label="Sayfa adı (listede ve h1 yedeği)" value={cfg.title} max={L.pageTitle} onChange={(v) => update((d) => void (d.title = v))} issues={issues} path="title" readOnly={readOnly} />
        </Full>
      </Card>

      <section className="space-y-3" aria-labelledby="bloklar">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="bloklar" className="font-display text-base font-extrabold text-ink-950">Bloklar ({cfg.blocks.length}/{L.maxBlocks})</h3>
          {!readOnly ? (
            <div className="flex items-center gap-2">
              <select aria-label="Eklenecek blok türü" value={addType} onChange={(e) => setAddType(e.target.value as BlockType)} className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm">
                {BLOCK_TYPES.map((t) => (
                  <option key={t} value={t}>{BLOCK_LABEL[t]}</option>
                ))}
              </select>
              <Button type="button" variant="outline" size="sm" disabled={cfg.blocks.length >= L.maxBlocks} onClick={() => setBlocks([...cfg.blocks, emptyBlock(addType)])}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Blok ekle
              </Button>
            </div>
          ) : null}
        </div>
        {cfg.blocks.length === 0 ? <p className="rounded-[var(--radius-panel)] border border-dashed border-line p-4 text-sm text-text-muted">Blok yok; yukarıdan bir blok ekleyin.</p> : null}
        <ol className="space-y-3">
          {cfg.blocks.map((b, i) => (
            <li key={i} className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-ink-950">{i + 1}. {BLOCK_LABEL[b.type]}</p>
                {!readOnly ? (
                  <div className="flex shrink-0 gap-1">
                    <Button type="button" variant="outline" size="icon" aria-label="Yukarı taşı" disabled={i === 0} onClick={() => setBlocks(moveInArray(cfg.blocks, i, i - 1))}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button type="button" variant="outline" size="icon" aria-label="Aşağı taşı" disabled={i === cfg.blocks.length - 1} onClick={() => setBlocks(moveInArray(cfg.blocks, i, i + 1))}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button type="button" variant="outline" size="icon" aria-label="Çoğalt" disabled={cfg.blocks.length >= L.maxBlocks} onClick={() => setBlocks([...cfg.blocks.slice(0, i + 1), structuredClone(b), ...cfg.blocks.slice(i + 1)])}><Copy className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button type="button" variant="outline" size="icon" aria-label="Sil" onClick={() => setBlocks(cfg.blocks.filter((_, n) => n !== i))}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                  </div>
                ) : null}
              </div>
              <BlockFields block={b} path={`blocks.${i}`} issues={issues} readOnly={readOnly} onChange={(nb) => update((d) => void (d.blocks[i] = nb))} />
            </li>
          ))}
        </ol>
      </section>

      <Card title="SEO">
        <Txt label="SEO başlığı (boşsa ilk girişten önerilir)" value={cfg.seo.title} max={L.seoTitle} onChange={(v) => update((d) => void (d.seo.title = v))} issues={issues} path="seo.title" readOnly={readOnly} hint={!cfg.seo.title && suggested.title ? `Öneri: ${suggested.title}` : undefined} />
        <Txt label="Paylaşım başlığı (isteğe bağlı)" value={cfg.seo.ogTitle ?? ""} max={L.ogTitle} onChange={(v) => update((d) => void (d.seo.ogTitle = v || undefined))} issues={issues} path="seo.ogTitle" readOnly={readOnly} />
        <Full>
          <Txt label="SEO açıklaması (boşsa ilk girişten önerilir)" value={cfg.seo.description} max={L.seoDescription} multiline onChange={(v) => update((d) => void (d.seo.description = v))} issues={issues} path="seo.description" readOnly={readOnly} hint={!cfg.seo.description && suggested.description ? `Öneri: ${suggested.description}` : undefined} />
        </Full>
        <Txt label="Paylaşım açıklaması (isteğe bağlı)" value={cfg.seo.ogDescription ?? ""} max={L.ogDescription} onChange={(v) => update((d) => void (d.seo.ogDescription = v || undefined))} issues={issues} path="seo.ogDescription" readOnly={readOnly} />
        <Txt label="Paylaşım görseli (/yol ya da https adresi)" value={cfg.seo.ogImage ?? ""} max={500} onChange={(v) => update((d) => void (d.seo.ogImage = v || undefined))} issues={issues} path="seo.ogImage" readOnly={readOnly} />
        <Check label="Arama motorları indekslesin" checked={cfg.seo.index} disabled={readOnly} onChange={(v) => update((d) => void (d.seo.index = v))} />
        <Check label="Sitemap'e ekle" checked={cfg.seo.inSitemap} disabled={readOnly || !cfg.seo.index} onChange={(v) => update((d) => void (d.seo.inSitemap = v))} />
        <Full>
          <SerpPreview title={titleTemplate.replace("%s", seoTitle || cfg.title)} url={`${baseUrl.replace(/\/+$/, "")}/${slug.trim() || entry.slug}`} description={seoDesc} />
        </Full>
      </Card>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-labelledby="gecmis">
        <h3 id="gecmis" className="mb-3 flex items-center gap-2 font-display text-base font-extrabold text-ink-950">
          <History className="h-4 w-4" aria-hidden="true" /> Geçmiş
        </h3>
        {history.length === 0 ? (
          <p className="text-sm text-text-muted">Henüz yayın yok. İlk yayından sonra her sürüm burada listelenir ve geri alınabilir.</p>
        ) : (
          <ul className="divide-y divide-line">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 text-sm">
                  <span className="font-semibold text-ink-950">{h.label}</span>
                  <span className="text-text-muted"> · {h.atLabel}{h.by ? ` · ${h.by}` : ""}</span>
                  {h.isLive ? <span className="ml-2 rounded-full bg-mint-500/15 px-2 py-0.5 text-xs font-bold text-mint-700">Yayında</span> : null}
                </span>
                {!readOnly && !h.isLive ? <InlineConfirm label="Bu sürüme dön" confirmLabel="Yayına al" icon={<Undo2 className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={() => rollback(h.id)} disabled={pending} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Banner({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  return (
    <p role={tone === "warn" ? "alert" : "status"} className={`flex items-start gap-2 rounded-[var(--radius-panel)] border px-4 py-3 text-sm ${tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-line bg-surface-2 text-text-muted"}`}>
      {tone === "warn" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      <span>{children}</span>
    </p>
  );
}

function SlugField({ value, onChange, locked }: { value: string; onChange: (v: string) => void; locked: boolean }) {
  const id = useId();
  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-ink-950">Sayfa yolu</label>
      <div className="flex items-center gap-1">
        <span className="text-sm text-text-muted">/</span>
        <Input id={id} value={value} maxLength={80} readOnly={locked} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-h`} />
      </div>
      <span id={`${id}-h`} className="mt-1 block text-xs text-text-faint">
        {locked ? "Yayındaki sayfanın yolu değişmez; önce yayından kaldırın." : "Küçük harf, rakam ve tire; en çok 3 bölüm. Sistem yolları kullanılamaz."}
      </span>
    </div>
  );
}

function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink-950">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
      {label}
    </label>
  );
}

type FieldProps<B> = { block: B; path: string; issues: readonly Issue[]; readOnly: boolean; onChange: (b: B) => void };

function LinkFields({ label, value, path, issues, readOnly, onChange }: { label: string; value: PageLink; path: string; issues: readonly Issue[]; readOnly: boolean; onChange: (v: PageLink) => void }) {
  return (
    <>
      <Txt label={`${label}: düğme metni`} value={value.label} max={L.ctaLabel} onChange={(v) => onChange({ ...value, label: v })} issues={issues} path={`${path}.label`} readOnly={readOnly} />
      <Txt label={`${label}: bağlantı`} value={value.href} max={L.href} onChange={(v) => onChange({ ...value, href: v })} issues={issues} path={`${path}.href`} readOnly={readOnly} list="site-menu-targets" />
    </>
  );
}

function OptionalLink({ label, value, path, issues, readOnly, onChange }: { label: string; value: PageLink | undefined; path: string; issues: readonly Issue[]; readOnly: boolean; onChange: (v: PageLink | undefined) => void }) {
  if (!value) {
    return readOnly ? null : (
      <Full>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange({ label: "Fiyatları görün", href: "/fiyatlar" })}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {label} ekle
        </Button>
      </Full>
    );
  }
  return (
    <>
      <LinkFields label={label} value={value} path={path} issues={issues} readOnly={readOnly} onChange={onChange} />
      {!readOnly ? (
        <Full>
          <Button type="button" variant="ghost" size="xs" onClick={() => onChange(undefined)}>{label} kaldır</Button>
        </Full>
      ) : null}
    </>
  );
}

/** Metin listesi (paragraflar / maddeler): ekle, sil. */
function StringList({ label, items, max, itemMax, multiline, path, issues, readOnly, onChange }: { label: string; items: string[]; max: number; itemMax: number; multiline?: boolean; path: string; issues: readonly Issue[]; readOnly: boolean; onChange: (v: string[]) => void }) {
  return (
    <Full>
      <div className="space-y-2">
        <p className="text-xs font-semibold text-ink-950">{label} ({items.length}/{max})</p>
        {items.map((it, n) => (
          <div key={n} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Txt label={`${n + 1}.`} value={it} max={itemMax} multiline={multiline} onChange={(v) => onChange(items.map((x, k) => (k === n ? v : x)))} issues={issues} path={`${path}.${n}`} readOnly={readOnly} />
            </div>
            {!readOnly ? (
              <Button type="button" variant="outline" size="icon" aria-label={`${n + 1}. öğeyi sil`} className="mt-5" onClick={() => onChange(items.filter((_, k) => k !== n))}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ))}
        {!readOnly ? (
          <Button type="button" variant="outline" size="sm" disabled={items.length >= max} onClick={() => onChange([...items, ""])}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Ekle
          </Button>
        ) : null}
      </div>
    </Full>
  );
}

function BlockFields(props: FieldProps<PageBlock>) {
  const { block: b, path, issues, readOnly, onChange } = props;
  const t = (label: string, key: string, value: string, max: number, set: (v: string) => void, multiline = false) => (
    <Txt label={label} value={value} max={max} multiline={multiline} onChange={set} issues={issues} path={`${path}.${key}`} readOnly={readOnly} />
  );
  switch (b.type) {
    case "hero":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {t("Üst başlık", "eyebrow", b.eyebrow, L.eyebrow, (v) => onChange({ ...b, eyebrow: v }))}
          {t("Başlık", "title", b.title, L.heading, (v) => onChange({ ...b, title: v }))}
          <Full>{t("Açıklama", "lead", b.lead, L.lead, (v) => onChange({ ...b, lead: v }), true)}</Full>
          <LinkFields label="Birincil düğme" value={b.primary} path={`${path}.primary`} issues={issues} readOnly={readOnly} onChange={(v) => onChange({ ...b, primary: v })} />
          <OptionalLink label="İkinci düğme" value={b.secondary} path={`${path}.secondary`} issues={issues} readOnly={readOnly} onChange={(v) => onChange({ ...b, secondary: v })} />
        </div>
      );
    case "text":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Full>{t("Ara başlık (isteğe bağlı)", "heading", b.heading ?? "", L.heading, (v) => onChange({ ...b, heading: v || undefined }))}</Full>
          <StringList label="Paragraflar (satır sonu yeni paragraf olur)" items={b.paragraphs} max={L.maxParagraphs} itemMax={L.paragraph} multiline path={`${path}.paragraphs`} issues={issues} readOnly={readOnly} onChange={(v) => onChange({ ...b, paragraphs: v })} />
          <StringList label="Maddeler" items={b.bullets} max={L.maxBullets} itemMax={L.bullet} path={`${path}.bullets`} issues={issues} readOnly={readOnly} onChange={(v) => onChange({ ...b, bullets: v })} />
        </div>
      );
    case "features":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Full>{t("Başlık", "heading", b.heading, L.heading, (v) => onChange({ ...b, heading: v }))}</Full>
          {b.items.map((it, n) => (
            <div key={n} className="grid gap-2 rounded-[var(--radius-card)] border border-line p-3 sm:col-span-2 sm:grid-cols-[12rem_1fr_auto]">
              <label className="text-xs font-semibold text-ink-950">
                Simge
                <select value={it.icon} disabled={readOnly} onChange={(e) => onChange({ ...b, items: b.items.map((x, k) => (k === n ? { ...x, icon: e.target.value } : x)) })} className="mt-1 block h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm font-normal">
                  {MENU_ICON_LIST.map((ic) => (
                    <option key={ic.name} value={ic.name}>{ic.label}</option>
                  ))}
                </select>
              </label>
              <div className="grid gap-2">
                <Txt label="Kart başlığı" value={it.title} max={L.featureTitle} onChange={(v) => onChange({ ...b, items: b.items.map((x, k) => (k === n ? { ...x, title: v } : x)) })} issues={issues} path={`${path}.items.${n}.title`} readOnly={readOnly} />
                <Txt label="Kart metni" value={it.text} max={L.featureText} multiline onChange={(v) => onChange({ ...b, items: b.items.map((x, k) => (k === n ? { ...x, text: v } : x)) })} issues={issues} path={`${path}.items.${n}.text`} readOnly={readOnly} />
              </div>
              {!readOnly ? (
                <Button type="button" variant="outline" size="icon" aria-label={`${n + 1}. kartı sil`} onClick={() => onChange({ ...b, items: b.items.filter((_, k) => k !== n) })}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          ))}
          {!readOnly ? (
            <Full>
              <Button type="button" variant="outline" size="sm" disabled={b.items.length >= L.maxFeatures} onClick={() => onChange({ ...b, items: [...b.items, { icon: "Sparkles", title: "Başlık", text: "" }] })}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Kart ekle
              </Button>
            </Full>
          ) : null}
        </div>
      );
    case "faq":
      return (
        <div className="grid gap-3">
          {b.items.map((it, n) => (
            <div key={n} className="grid gap-2 rounded-[var(--radius-card)] border border-line p-3 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-2">
                <Txt label={`${n + 1}. soru`} value={it.q} max={L.question} onChange={(v) => onChange({ ...b, items: b.items.map((x, k) => (k === n ? { ...x, q: v } : x)) })} issues={issues} path={`${path}.items.${n}.q`} readOnly={readOnly} />
                <Txt label="Cevap" value={it.a} max={L.answer} multiline onChange={(v) => onChange({ ...b, items: b.items.map((x, k) => (k === n ? { ...x, a: v } : x)) })} issues={issues} path={`${path}.items.${n}.a`} readOnly={readOnly} />
              </div>
              {!readOnly ? (
                <div className="flex gap-1 sm:flex-col">
                  <Button type="button" variant="outline" size="icon" aria-label="Yukarı taşı" disabled={n === 0} onClick={() => onChange({ ...b, items: moveInArray(b.items, n, n - 1) })}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button type="button" variant="outline" size="icon" aria-label="Aşağı taşı" disabled={n === b.items.length - 1} onClick={() => onChange({ ...b, items: moveInArray(b.items, n, n + 1) })}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button type="button" variant="outline" size="icon" aria-label={`${n + 1}. soruyu sil`} onClick={() => onChange({ ...b, items: b.items.filter((_, k) => k !== n) })}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                </div>
              ) : null}
            </div>
          ))}
          {!readOnly ? (
            <div>
              <Button type="button" variant="outline" size="sm" disabled={b.items.length >= L.maxFaq} onClick={() => onChange({ ...b, items: [...b.items, { q: "Soru", a: "Cevap" }] })}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Soru ekle
              </Button>
            </div>
          ) : null}
          <p className="text-xs text-text-faint">Sorular sayfada açılır liste olarak görünür ve arama motorları için FAQPage yapılandırılmış verisine aynen girer.</p>
        </div>
      );
    case "cta":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Full>{t("Başlık", "title", b.title, L.heading, (v) => onChange({ ...b, title: v }))}</Full>
          <Full>{t("Metin", "text", b.text, L.lead, (v) => onChange({ ...b, text: v }), true)}</Full>
          <LinkFields label="Birincil düğme" value={b.primary} path={`${path}.primary`} issues={issues} readOnly={readOnly} onChange={(v) => onChange({ ...b, primary: v })} />
          <OptionalLink label="İkinci düğme" value={b.secondary} path={`${path}.secondary`} issues={issues} readOnly={readOnly} onChange={(v) => onChange({ ...b, secondary: v })} />
        </div>
      );
    case "contact":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Full>{t("Başlık", "heading", b.heading, L.heading, (v) => onChange({ ...b, heading: v }))}</Full>
          <Check label="E-posta göster" checked={b.showEmail} disabled={readOnly} onChange={(v) => onChange({ ...b, showEmail: v })} />
          <Check label="Telefon göster" checked={b.showPhone} disabled={readOnly} onChange={(v) => onChange({ ...b, showPhone: v })} />
          <Check label="Adres göster" checked={b.showAddress} disabled={readOnly} onChange={(v) => onChange({ ...b, showAddress: v })} />
          <Full>
            <p className="text-xs text-text-faint">
              Bilgiler <Link href="/admin/site/seo" className="font-semibold underline">SEO &gt; Kurum bilgisi</Link>&apos;nden salt okunur gelir; boş alan sayfada gösterilmez. Adres alanı kurum bilgisinde henüz yok.
            </p>
          </Full>
        </div>
      );
  }
}
