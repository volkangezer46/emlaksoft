"use client";

import { useCallback, useEffect, useId, useMemo, useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, Eye, History, Plus, Save, Send, Undo2 } from "lucide-react";
import { publishGuide, rollbackGuide, saveGuideDraft, unpublishGuide } from "@/app/actions/site-guides";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, Full, Txt } from "@/app/admin/site/sayfalar/ana-sayfa/editor-fields";
import { InlineConfirm } from "@/app/admin/site/menu/editor-ui";
import { SerpPreview } from "@/app/admin/site/seo/seo-ui";
import type { Issue } from "@/lib/site-menu/schema-core";
import {
  GUIDE_CATEGORIES,
  GUIDE_CATEGORY_LABEL,
  GUIDE_LIMITS as L,
  GUIDE_STATUS_LABEL,
  THIN_CONTENT_WORDS,
  guidePath,
  sameGuide,
  type GuideCategory,
  type GuideContent,
  type GuideIndexEntry,
} from "@/lib/guides/defaults";
import { toGuideSlug } from "@/lib/guides/slug";
import { RICH_BLOCK_LABEL, RICH_BLOCK_TYPES, RICH_LIMITS, TOOL_EMBED_SLUGS, emptyRichBlock, excerptOf, plainTextOf, wordCount, type RichBlockType } from "@/lib/rich-text/core";
import type { validateGuide } from "@/lib/guides/schema";
import { TOOLS } from "@/lib/tools/registry";
import { BlockList, type BlockRow } from "./block-list";

export type GuideHistoryView = { id: string; atLabel: string; by: string; label: string; isLive: boolean };

type Props = {
  id: string;
  entry: GuideIndexEntry;
  initialDraft: GuideContent;
  live: GuideContent | null;
  history: GuideHistoryView[];
  /** Yayın, geri alma, yayından kaldırma: yalnız süper admin. Taslak: sitecontent modülü olan herkes. */
  canPublish: boolean;
  baseUrl: string;
  titleTemplate: string;
  /** İç bağlantı sayılan rehber yolları (kırık bağlantı uyarısı). */
  linkPaths: string[];
};

type Meta = Omit<GuideContent, "body">;

const hasErrors = (issues: readonly Issue[]) => issues.some((i) => i.level === "error");
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2));

export function GuideEditor({ id, entry, initialDraft, live, history, canPublish, baseUrl, titleTemplate, linkPaths }: Props) {
  const router = useRouter();
  const { body: initialBody, ...initialMeta } = initialDraft;
  const [meta, setMeta] = useState<Meta>(initialMeta);
  const [rows, setRows] = useState<BlockRow[]>(() => initialBody.map((block, i) => ({ key: `b${i}`, block })));
  const [saved, setSaved] = useState<GuideContent>(initialDraft);
  const [slug, setSlug] = useState(entry.slug);
  const [note, setNote] = useState("");
  const [addType, setAddType] = useState<RichBlockType>("p");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  const [pending, start] = useTransition();
  const published = entry.status === "yayinda";
  const cfg: GuideContent = useMemo(() => ({ ...meta, body: rows.map((r) => r.block) }), [meta, rows]);

  // Canlı doğrulama zod gerektirir: ayrı parça, boşta yüklenir (sunucu kaydederken yine doğrular).
  const [validate, setValidate] = useState<typeof validateGuide | null>(null);
  useEffect(() => {
    let alive = true;
    void import("@/lib/guides/schema").then((m) => {
      if (alive) setValidate(() => m.validateGuide);
    });
    return () => {
      alive = false;
    };
  }, []);
  const issues = useMemo(() => (validate ? validate(cfg, { extraPaths: linkPaths }).issues : serverIssues), [validate, cfg, linkPaths, serverIssues]);
  const errorCount = issues.filter((i) => i.level === "error").length;
  const warnCount = issues.length - errorCount;
  const blocked = !validate || hasErrors(issues);
  // Yol normalize haliyle karşılaştırılır (sunucu "Kira Artışı"nı "kira-artisi" olarak kaydeder); yayındaki yazının yolu kilitlidir.
  const slugDirty = !published && toGuideSlug(slug.trim()) !== entry.slug;
  const dirty = !sameGuide(cfg, saved) || slugDirty;
  // Yayındaki yazıda yol gönderilmez: kilitli alan sunucuda "yol değiştirilemez" hatasına yol açmasın.
  const slugToSend = published ? undefined : slug;
  const pendingPublish = !published || !sameGuide(saved, live);
  const brokenLinks = issues.filter((i) => i.message.startsWith("Kırık iç bağlantı"));
  const words = wordCount(plainTextOf(cfg.body));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const updateMeta = useCallback((fn: (m: Meta) => Meta) => {
    setMeta((prev) => fn(prev));
    setMsg(null);
  }, []);
  const updateRows = (next: BlockRow[]) => {
    setRows(next);
    setMsg(null);
  };

  type RunResult = { ok?: boolean; error?: string; issues?: Issue[]; slug?: string };
  const run = (job: () => Promise<RunResult>, okText: string, after?: (res: RunResult) => void) => {
    setMsg(null);
    start(async () => {
      const res = await job();
      if (res.issues) setServerIssues(res.issues);
      if (res.error) {
        setMsg({ kind: "error", text: res.error });
        return;
      }
      after?.(res);
      setMsg({ kind: "ok", text: okText });
      router.refresh();
    });
  };

  const saveDraft = () =>
    run(() => saveGuideDraft(id, cfg, slugToSend), "Taslak kaydedildi. Canlı yazı değişmedi.", (res) => {
      setSaved(cfg);
      if (res.slug) setSlug(res.slug);
    });
  const publish = () =>
    run(
      async () => {
        let savedSlug: string | undefined;
        if (dirty) {
          const s = await saveGuideDraft(id, cfg, slugToSend);
          if (s.error) return s;
          savedSlug = s.slug;
        }
        const p = await publishGuide(id, note);
        return { ...p, slug: savedSlug };
      },
      "Yayınlandı. Yazı birkaç saniye içinde canlıda.",
      (res) => {
        setNote("");
        setSaved(cfg);
        if (res.slug) setSlug(res.slug);
      },
    );
  const unpublish = () => run(() => unpublishGuide(id), "Yayından kaldırıldı; bu yol artık 404 döner.");
  const rollback = (versionId: string) => run(() => rollbackGuide(id, versionId), "Seçilen sürüm yayına alındı.");

  const seoTitle = meta.seo.title || meta.title;
  const seoDesc = meta.seo.description || excerptOf(cfg.body, L.seoDescription);

  return (
    <div className="space-y-5">
      {!canPublish ? <Banner tone="info">Bu hesap taslak yazabilir; yayınlama ve geri alma süper admin yetkisindedir.</Banner> : null}

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-700">{GUIDE_STATUS_LABEL[entry.status]}</span>
          {published ? (
            <a href={guidePath(entry.slug)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">
              Canlıda aç
            </a>
          ) : null}
          <Link href={`/admin/site/rehber/${id}/onizleme`} target="_blank" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
            <Eye className="h-4 w-4" aria-hidden="true" /> Önizle (kayıtlı taslak)
          </Link>
          {/* Rehber yüzeyi Yayın masasına (surfaces.ts) kaydedilince buraya "Zamanla: Yayın masası" bağlantısı döner. */}
          <span className="inline-flex min-h-11 items-center text-sm text-text-faint">Zamanlı yayın yakında</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={saveDraft} loading={pending} disabled={blocked || !dirty}>
            <Save className="h-4 w-4" aria-hidden="true" /> Taslağı kaydet
          </Button>
          {canPublish ? (
            <>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} placeholder="Yayın notu (isteğe bağlı)" aria-label="Yayın notu" className="w-56" />
              <Button type="button" onClick={publish} loading={pending} disabled={blocked || (!dirty && !pendingPublish)}>
                <Send className="h-4 w-4" aria-hidden="true" /> Yayınla
              </Button>
              {published ? <InlineConfirm label="Yayından kaldır" confirmLabel="Kaldır" tone="danger" icon={<Archive className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={unpublish} disabled={pending} /> : null}
            </>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-text-muted" role="status">
          {!validate ? "Doğrulayıcı yükleniyor…" : errorCount ? `${errorCount} hata düzeltilmeden kaydedilemez.` : "Hata yok."}
          {warnCount ? ` ${warnCount} uyarı (engellemez).` : ""}
          {dirty ? " Kaydedilmemiş değişiklik var." : ""}
        </p>
        {msg ? (
          <p role={msg.kind === "error" ? "alert" : "status"} className={`mt-2 rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium ${msg.kind === "error" ? "bg-danger-500/8 text-danger-600" : "bg-mint-500/10 text-mint-700"}`}>
            {msg.text}
          </p>
        ) : null}
      </section>

      <Card title="Yazı">
        <Full>
          <Txt label="Başlık (h1)" value={meta.title} max={L.title} onChange={(v) => updateMeta((m) => ({ ...m, title: v }))} issues={issues} path="title" readOnly={false} />
        </Full>
        <label className="text-xs font-semibold text-ink-950">
          Kategori
          <select
            value={meta.category}
            onChange={(e) => updateMeta((m) => ({ ...m, category: e.target.value as GuideCategory }))}
            className="mt-1 block h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm font-normal"
          >
            {GUIDE_CATEGORIES.map((k) => (
              <option key={k} value={k}>{GUIDE_CATEGORY_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <fieldset className="min-w-0">
          <legend className="mb-1 text-xs font-semibold text-ink-950">İlgili araçlar ({meta.relatedTools.length}/{L.maxRelatedTools})</legend>
          <div className="grid gap-1">
            {TOOL_EMBED_SLUGS.map((s) => (
              <label key={s} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={meta.relatedTools.includes(s)}
                  onChange={(e) => updateMeta((m) => ({ ...m, relatedTools: e.target.checked ? [...m.relatedTools, s] : m.relatedTools.filter((x) => x !== s) }))}
                />
                {TOOLS.find((t) => t.slug === s)?.title ?? s}
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <section className="space-y-3" aria-labelledby="bloklar">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="bloklar" className="font-display text-base font-extrabold text-ink-950">
            Bloklar ({rows.length}/{RICH_LIMITS.maxBlocks}) <span className="text-sm font-semibold text-text-muted">· {words} kelime</span>
          </h3>
          <div className="flex items-center gap-2">
            <select aria-label="Eklenecek blok türü" value={addType} onChange={(e) => setAddType(e.target.value as RichBlockType)} className="h-11 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm">
              {RICH_BLOCK_TYPES.map((t) => (
                <option key={t} value={t}>{RICH_BLOCK_LABEL[t]}</option>
              ))}
            </select>
            <Button type="button" variant="outline" size="sm" disabled={rows.length >= RICH_LIMITS.maxBlocks} onClick={() => updateRows([...rows, { key: newKey(), block: emptyRichBlock(addType) }])}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Blok ekle
            </Button>
          </div>
        </div>
        {rows.length === 0 ? <p className="rounded-[var(--radius-panel)] border border-dashed border-line p-4 text-sm text-text-muted">Blok yok; yukarıdan bir blok ekleyin.</p> : null}
        <BlockList rows={rows} onChange={updateRows} issues={issues} readOnly={false} />
      </section>

      <Card title="SEO">
        <Txt
          label="SEO başlığı (boşsa yazı başlığı)"
          value={meta.seo.title}
          max={L.seoTitle}
          onChange={(v) => updateMeta((m) => ({ ...m, seo: { ...m.seo, title: v } }))}
          issues={issues}
          path="seo.title"
          readOnly={false}
        />
        <SlugField value={slug} onChange={setSlug} locked={published} />
        <Full>
          <Txt
            label="SEO açıklaması (boşsa ilk paragraftan özet)"
            value={meta.seo.description}
            max={L.seoDescription}
            multiline
            onChange={(v) => updateMeta((m) => ({ ...m, seo: { ...m.seo, description: v } }))}
            issues={issues}
            path="seo.description"
            readOnly={false}
            hint={!meta.seo.description && seoDesc ? `Öneri: ${seoDesc}` : undefined}
          />
        </Full>
        <Full>
          <SerpPreview title={titleTemplate.replace("%s", seoTitle)} url={`${baseUrl.replace(/\/+$/, "")}${guidePath(slug.trim() || entry.slug)}`} description={seoDesc} />
        </Full>
        <Full>
          <ul className="space-y-1 text-xs">
            <li className={words < THIN_CONTENT_WORDS ? "font-semibold text-amber-700" : "text-text-muted"}>
              {words < THIN_CONTENT_WORDS
                ? `İnce içerik: ${words}/${THIN_CONTENT_WORDS} kelime. Yazı yayında görünür ama arama motorlarına kapalıdır ve sitemap'e girmez.`
                : `${words} kelime; indekslenebilir.`}
            </li>
            {brokenLinks.length === 0 ? (
              <li className="text-text-muted">Kırık iç bağlantı yok.</li>
            ) : (
              brokenLinks.map((b, i) => (
                <li key={i} className="flex items-start gap-1 font-semibold text-amber-700">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {b.path}: {b.message}
                </li>
              ))
            )}
          </ul>
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
                {canPublish && !h.isLive ? <InlineConfirm label="Bu sürüme dön" confirmLabel="Yayına al" icon={<Undo2 className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={() => rollback(h.id)} disabled={pending} /> : null}
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
  const suggestion = toGuideSlug(value);
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 flex items-baseline justify-between gap-2 text-xs font-semibold text-ink-950">
        <span>Yol (slug)</span>
        <span className="font-normal text-text-faint">{value.length}/{L.slug}</span>
      </label>
      <div className="flex items-center gap-1">
        <span className="shrink-0 text-sm text-text-muted">/rehber/</span>
        <Input id={id} value={value} maxLength={L.slug} readOnly={locked} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-h`} />
      </div>
      <span id={`${id}-h`} className="mt-1 block text-xs text-text-faint">
        {locked
          ? "Yayındaki yazının yolu değişmez; önce yayından kaldırın."
          : suggestion && suggestion !== value.trim()
            ? `Kaydedilince: ${suggestion}`
            : "Küçük harf, rakam ve tire; Türkçe harfler sadeleşir."}
      </span>
    </div>
  );
}
