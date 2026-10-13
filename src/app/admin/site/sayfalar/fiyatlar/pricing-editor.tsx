"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, History, Plus, RotateCcw, Save, Send, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { publishPricingPage, resetPricingPageToDefault, rollbackPricingPage, savePricingPageDraft } from "@/app/actions/pricing-page";
import { Card, Full, Txt } from "@/app/admin/site-icerik/editor-fields";
import { InlineConfirm } from "@/app/admin/site-menu/editor-ui";
import { moveInArray } from "@/lib/site-menu/editor-model";
import type { Issue } from "@/lib/site-menu/schema-core";
import { ALL_PRICING_TOKENS, PRICING_LIMITS as L, samePricing, type PricingPageContent } from "@/lib/pricing-page/schema-core";
import type { validatePricingPage } from "@/lib/pricing-page/schema";

export type PricingHistoryView = { id: string; atLabel: string; by: string; label: string; isLive: boolean };

type Props = { initialDraft: PricingPageContent; live: PricingPageContent | null; defaults: PricingPageContent; history: PricingHistoryView[]; canWrite: boolean };

const hasErrors = (issues: readonly Issue[]) => issues.some((i) => i.level === "error");

export function PricingPageEditor({ initialDraft, live, defaults, history, canWrite }: Props) {
  const router = useRouter();
  const readOnly = !canWrite;
  const [cfg, setCfg] = useState<PricingPageContent>(initialDraft);
  const [saved, setSaved] = useState<PricingPageContent>(initialDraft);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const [validate, setValidate] = useState<typeof validatePricingPage | null>(null);
  useEffect(() => {
    let alive = true;
    void import("@/lib/pricing-page/schema").then((m) => {
      if (alive) setValidate(() => m.validatePricingPage);
    });
    return () => {
      alive = false;
    };
  }, []);
  const issues = useMemo(() => (validate ? validate(cfg).issues : []), [validate, cfg]);
  const errorCount = issues.filter((i) => i.level === "error").length;
  const blocked = !validate || hasErrors(issues);
  const dirty = !samePricing(cfg, saved);
  const pendingPublish = !samePricing(saved, live ?? defaults);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = useCallback((fn: (d: PricingPageContent) => void) => {
    setCfg((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setMsg(null);
  }, []);

  const run = (job: () => Promise<{ ok?: boolean; error?: string; config?: PricingPageContent }>, okText: string, after?: (c?: PricingPageContent) => void) => {
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
    });
  };
  const adopt = (c?: PricingPageContent) => {
    if (c) {
      setCfg(c);
      setSaved(c);
    }
  };

  const saveDraft = () => run(() => savePricingPageDraft(cfg), "Taslak kaydedildi. Henüz canlı değil.", () => setSaved(cfg));
  const publish = () =>
    run(
      async () => {
        if (dirty) {
          const s = await savePricingPageDraft(cfg);
          if (s.error) return s;
        }
        return publishPricingPage(note);
      },
      "Yayınlandı. /fiyatlar birkaç saniye içinde yenilenir.",
      () => {
        setNote("");
        setSaved(cfg);
      },
    );

  const txt = (label: string, path: string, value: string, max: number, set: (d: PricingPageContent, v: string) => void, multiline = false) => (
    <Txt label={label} value={value} max={max} multiline={multiline} onChange={(v) => update((d) => set(d, v))} issues={issues} path={path} readOnly={readOnly} />
  );

  return (
    <div className="space-y-5">
      {readOnly ? <p role="status" className="rounded-[var(--radius-panel)] border border-line bg-surface-2 px-4 py-3 text-sm text-text-muted">Bu hesap salt okunur; metinleri yalnız süper admin değiştirebilir.</p> : null}

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-700">{live ? "Özel yayın" : "Varsayılan metin"}</span>
          <Link href="/admin/site/sayfalar/fiyatlar/onizleme" target="_blank" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
            <Eye className="h-4 w-4" aria-hidden="true" /> Önizle (kayıtlı taslak)
          </Link>
          <Link href="/admin/billing/planlar" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">Fiyatlar ve limitler: plan editörü</Link>
        </div>
        {!readOnly ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={saveDraft} loading={pending} disabled={blocked || !dirty}>
              <Save className="h-4 w-4" aria-hidden="true" /> Taslağı kaydet
            </Button>
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} placeholder="Yayın notu (isteğe bağlı)" aria-label="Yayın notu" className="w-56" />
            <Button type="button" onClick={publish} loading={pending} disabled={blocked || (!dirty && !pendingPublish)}>
              <Send className="h-4 w-4" aria-hidden="true" /> Yayınla
            </Button>
            {live ? <InlineConfirm label="Varsayılana dön" confirmLabel="Dön" tone="danger" icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={() => run(() => resetPricingPageToDefault(), "Bugünkü (kod içi) metinlere dönüldü.", adopt)} disabled={pending} /> : null}
          </div>
        ) : null}
        <p className="mt-3 text-xs text-text-muted" role="status">
          {!validate ? "Doğrulayıcı yükleniyor…" : errorCount ? `${errorCount} hata düzeltilmeden kaydedilemez.` : "Hata yok."}
          {dirty ? " Kaydedilmemiş değişiklik var." : ""}
        </p>
        {msg ? (
          <p role={msg.kind === "error" ? "alert" : "status"} className={`mt-2 rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium ${msg.kind === "error" ? "bg-danger-500/8 text-danger-600" : "bg-mint-500/10 text-mint-700"}`}>
            {msg.text}
          </p>
        ) : null}
      </section>

      <details className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink-950">Kullanılabilir değişkenler</summary>
        <p className="mt-2 text-xs text-text-muted">Değerler paket tanımlarından ve sayfa kilitlerinden gelir; gün, oran veya paket adı metne elle yazılmaz.</p>
        <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
          {ALL_PRICING_TOKENS.map((t) => (
            <li key={t.name}>
              <code className="font-semibold text-ink-950">{`{${t.name}}`}</code> <span className="text-text-muted">{t.help}</span>
            </li>
          ))}
        </ul>
      </details>

      <Card title="Üst bant">
        {txt("Üst başlık", "hero.eyebrow", cfg.hero.eyebrow, L.eyebrow, (d, v) => void (d.hero.eyebrow = v))}
        {txt("Başlık", "hero.title", cfg.hero.title, L.title, (d, v) => void (d.hero.title = v))}
        <Full>{txt("Açıklama", "hero.lead", cfg.hero.lead, L.lead, (d, v) => void (d.hero.lead = v), true)}</Full>
        {txt("Birincil düğme", "ctaPrimaryLabel", cfg.ctaPrimaryLabel, L.label, (d, v) => void (d.ctaPrimaryLabel = v))}
        {txt("Karşılaştır düğmesi", "compareLabel", cfg.compareLabel, L.label, (d, v) => void (d.compareLabel = v))}
      </Card>

      <Card title="Bilmeniz gerekenler (3 kart)">
        {cfg.notes.map((n, i) => (
          <Full key={i}>
            <div className="grid gap-2 rounded-[var(--radius-card)] border border-line p-3 sm:grid-cols-2">
              {txt(`${i + 1}. kart başlığı`, `notes.${i}.title`, n.title, L.noteTitle, (d, v) => void (d.notes[i]!.title = v))}
              {txt(`${i + 1}. kart metni`, `notes.${i}.text`, n.text, L.noteText, (d, v) => void (d.notes[i]!.text = v), true)}
            </div>
          </Full>
        ))}
      </Card>

      <Card title="Bölümler">
        {txt("Karşılaştırma başlığı", "sections.compare.title", cfg.sections.compare.title, L.sectionTitle, (d, v) => void (d.sections.compare.title = v))}
        {txt("Karşılaştırma açıklaması", "sections.compare.lead", cfg.sections.compare.lead, L.sectionLead, (d, v) => void (d.sections.compare.lead = v), true)}
        {txt("Analiz bakiyesi başlığı", "sections.analiz.title", cfg.sections.analiz.title, L.sectionTitle, (d, v) => void (d.sections.analiz.title = v))}
        {txt("Hesaplayıcı başlığı", "sections.roi.title", cfg.sections.roi.title, L.sectionTitle, (d, v) => void (d.sections.roi.title = v))}
        <Full>{txt("Hesaplayıcı açıklaması", "sections.roi.lead", cfg.sections.roi.lead, L.sectionLead, (d, v) => void (d.sections.roi.lead = v), true)}</Full>
        {txt("SSS başlığı", "sections.faq.title", cfg.sections.faq.title, L.sectionTitle, (d, v) => void (d.sections.faq.title = v))}
        {txt("Son çağrı başlığı", "sections.final.title", cfg.sections.final.title, L.sectionTitle, (d, v) => void (d.sections.final.title = v))}
        {txt("Son çağrı metni", "sections.final.text", cfg.sections.final.text, L.sectionLead, (d, v) => void (d.sections.final.text = v))}
        {txt("Son çağrı düğmesi", "sections.final.primaryLabel", cfg.sections.final.primaryLabel, L.label, (d, v) => void (d.sections.final.primaryLabel = v))}
      </Card>

      <Card title="EmlakFiyati analiz bakiyesi metinleri">
        <Full>{txt("Açıklama (değerleme canlıyken)", "efText.leadLive", cfg.efText.leadLive, L.efText, (d, v) => void (d.efText.leadLive = v), true)}</Full>
        <Full>{txt("Açıklama (değerleme henüz açık değilken)", "efText.leadPlanned", cfg.efText.leadPlanned, L.efText, (d, v) => void (d.efText.leadPlanned = v), true)}</Full>
        <Full>{txt("Aylık bakiye notu", "efText.creditsNote", cfg.efText.creditsNote, L.efText, (d, v) => void (d.efText.creditsNote = v), true)}</Full>
        <Full>{txt("Ek paket notu", "efText.packsNote", cfg.efText.packsNote, L.efText, (d, v) => void (d.efText.packsNote = v), true)}</Full>
      </Card>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-labelledby="fiyat-sss">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 id="fiyat-sss" className="font-display text-base font-extrabold text-ink-950">Sık sorulanlar ({cfg.faq.length}/{L.maxFaq})</h3>
          {!readOnly ? (
            <Button type="button" variant="outline" size="sm" disabled={cfg.faq.length >= L.maxFaq} onClick={() => update((d) => void d.faq.push({ q: "Yeni soru", a: "Cevap" }))}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Soru ekle
            </Button>
          ) : null}
        </div>
        <p className="mb-3 text-xs text-text-faint">Sorular /fiyatlar&apos;da ve FAQPage yapılandırılmış verisinde aynen görünür. Değişkeni şu an değersiz olan soru (ör. indirim yokken {"{indirim}"}) gizlenir.</p>
        <ol className="space-y-3">
          {cfg.faq.map((f, i) => (
            <li key={i} className="grid gap-2 rounded-[var(--radius-card)] border border-line p-3 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-2">
                {txt(`${i + 1}. soru`, `faq.${i}.q`, f.q, L.question, (d, v) => void (d.faq[i]!.q = v))}
                {txt("Cevap", `faq.${i}.a`, f.a, L.answer, (d, v) => void (d.faq[i]!.a = v), true)}
              </div>
              {!readOnly ? (
                <div className="flex gap-1 sm:flex-col">
                  <Button type="button" variant="outline" size="icon" aria-label="Yukarı taşı" disabled={i === 0} onClick={() => update((d) => void (d.faq = moveInArray(d.faq, i, i - 1)))}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button type="button" variant="outline" size="icon" aria-label="Aşağı taşı" disabled={i === cfg.faq.length - 1} onClick={() => update((d) => void (d.faq = moveInArray(d.faq, i, i + 1)))}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button type="button" variant="outline" size="icon" aria-label={`${i + 1}. soruyu sil`} onClick={() => update((d) => void d.faq.splice(i, 1))}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-labelledby="fiyat-gecmis">
        <h3 id="fiyat-gecmis" className="mb-3 flex items-center gap-2 font-display text-base font-extrabold text-ink-950">
          <History className="h-4 w-4" aria-hidden="true" /> Geçmiş
        </h3>
        {history.length === 0 ? (
          <p className="text-sm text-text-muted">Henüz yayın yok; sayfa bugünkü metinle çalışıyor.</p>
        ) : (
          <ul className="divide-y divide-line">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 text-sm">
                  <span className="font-semibold text-ink-950">{h.label}</span>
                  <span className="text-text-muted"> · {h.atLabel}{h.by ? ` · ${h.by}` : ""}</span>
                  {h.isLive ? <span className="ml-2 rounded-full bg-mint-500/15 px-2 py-0.5 text-xs font-bold text-mint-700">Yayında</span> : null}
                </span>
                {!readOnly && !h.isLive ? <InlineConfirm label="Bu sürüme dön" confirmLabel="Yayına al" icon={<Undo2 className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={() => run(() => rollbackPricingPage(h.id), "Seçilen sürüm yayına alındı.", adopt)} disabled={pending} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
