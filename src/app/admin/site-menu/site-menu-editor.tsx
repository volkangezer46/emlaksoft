"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, History, Loader2, RotateCcw, Save, Send, Undo2 } from "lucide-react";
import {
  discardSiteMenuDraft,
  publishSiteMenu,
  resetSiteMenuToDefault,
  rollbackSiteMenu,
  saveSiteMenuDraft,
} from "@/app/actions/site-menu";
import { Input } from "@/components/ui/input";
import { hasErrors, validateSiteMenu, type SiteMenuConfig } from "@/lib/site-menu/schema";
import { sameConfig } from "@/lib/site-menu/editor-model";
import type { MediaEntry } from "@/lib/site-menu/store";
import { AnnouncementTab, FooterTab } from "./footer-announcement-tabs";
import { MenuPreview } from "./menu-preview";
import { MenuTab, type Update } from "./menu-tab";
import { InlineConfirm, TargetDatalist, btn } from "./editor-ui";

type Tab = "menu" | "footer" | "announcement" | "versions";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "menu", label: "Üst menü" },
  { id: "footer", label: "Alt bilgi" },
  { id: "announcement", label: "Duyuru şeridi" },
  { id: "versions", label: "Sürümler" },
];

export type HistoryView = { id: string; atLabel: string; by: string; label: string; groups: number; items: number; isLive: boolean };

type Props = {
  initialDraft: SiteMenuConfig;
  live: SiteMenuConfig | null;
  defaults: SiteMenuConfig;
  history: HistoryView[];
  media: MediaEntry[];
  canWrite: boolean;
};

export function SiteMenuEditor({ initialDraft, live, defaults, history, media: initialMedia, canWrite }: Props) {
  const router = useRouter();
  const readOnly = !canWrite;
  const [cfg, setCfg] = useState<SiteMenuConfig>(initialDraft);
  const [saved, setSaved] = useState<SiteMenuConfig>(initialDraft);
  const [media, setMedia] = useState<MediaEntry[]>(initialMedia);
  const [tab, setTab] = useState<Tab>("menu");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const issues = useMemo(() => validateSiteMenu(cfg, { media }).issues, [cfg, media]);
  const errorCount = issues.filter((i) => i.level === "error").length;
  const warnCount = issues.length - errorCount;
  const blocked = hasErrors(issues);
  const dirty = !sameConfig(cfg, saved);
  const liveCfg = live ?? defaults;
  const pendingPublish = !sameConfig(saved, liveCfg);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
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

  const addMedia = useCallback((m: MediaEntry) => setMedia((list) => (list.some((x) => x.id === m.id) ? list : [...list, m])), []);

  const run = (job: () => Promise<{ ok?: boolean; error?: string; config?: SiteMenuConfig }>, okText: string, after?: (c?: SiteMenuConfig) => void) => {
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

  const saveDraft = () =>
    run(() => saveSiteMenuDraft(cfg), "Taslak kaydedildi. Henüz canlı değil.", (c) => {
      const next = c ?? cfg;
      setSaved(next);
      setCfg((cur) => (sameConfig(cur, cfg) ? next : cur));
    });

  const publish = () =>
    run(
      async () => {
        if (dirty) {
          const s = await saveSiteMenuDraft(cfg);
          if (s.error) return s;
          if (s.config) setSaved(s.config);
        }
        return publishSiteMenu(note);
      },
      "Yayınlandı. Site genelinde birkaç saniye içinde yansır.",
      () => {
        setNote("");
        setSaved(cfg);
      },
    );

  const discard = () =>
    run(discardSiteMenuDraft, "Taslak bırakıldı; canlı menüyle eşitlendi.", (c) => {
      if (c) {
        setCfg(c);
        setSaved(c);
      }
    });

  const resetDefault = () =>
    run(resetSiteMenuToDefault, "Varsayılan menüye dönüldü; site kodundaki ilk haliyle çalışıyor.", (c) => {
      if (c) {
        setCfg(c);
        setSaved(c);
      }
    });

  const rollback = (id: string) =>
    run(() => rollbackSiteMenu(id), "Seçilen sürüm canlıya alındı.", (c) => {
      if (c) {
        setCfg(c);
        setSaved(c);
      }
    });

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    setTab(TABS[n].id);
    tabRefs.current[n]?.focus();
  };

  return (
    <div className="space-y-5">
      <TargetDatalist />
      {readOnly ? (
        <p role="status" className="rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Bu ekran sizin rolünüz için salt okunurdur; yalnız süper admin değiştirebilir.
        </p>
      ) : null}

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-label="Taslak ve yayın">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${live ? "bg-brand-600/10 text-brand-700" : "bg-ink-950/6 text-text-muted"}`}>
            Canlı: {live ? "Özel yayın" : "Varsayılan menü"}
          </span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${dirty ? "bg-amber-100 text-amber-900" : pendingPublish ? "bg-brand-600/10 text-brand-700" : "bg-mint-500/15 text-mint-700"}`}>
            {dirty ? "Kaydedilmemiş değişiklik var" : pendingPublish ? "Taslak kayıtlı, yayınlanmadı" : "Taslak canlıyla aynı"}
          </span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${errorCount ? "bg-danger-500/12 text-danger-600" : "bg-ink-950/6 text-text-muted"}`}>
            {errorCount} hata · {warnCount} uyarı
          </span>
        </div>

        {!readOnly ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <button type="button" className={btn} disabled={pending || !dirty || blocked} onClick={saveDraft}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />} Taslağı kaydet
            </button>
            <label className="min-w-[10rem] flex-1 sm:max-w-xs">
              <span className="sr-only">Sürüm notu</span>
              <Input placeholder="Sürüm notu (isteğe bağlı)" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} />
            </label>
            <InlineConfirm
              label="Yayınla"
              confirmLabel="Evet, canlıya al"
              disabled={pending || blocked || (!dirty && !pendingPublish)}
              icon={<Send className="h-3.5 w-3.5" aria-hidden="true" />}
              onConfirm={publish}
            />
            <InlineConfirm label="Taslağı bırak" confirmLabel="Evet, bırak" tone="danger" disabled={pending || (!dirty && !pendingPublish)} icon={<Undo2 className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={discard} />
            <InlineConfirm label="Varsayılana dön" confirmLabel="Evet, sıfırla" tone="danger" disabled={pending} icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={resetDefault} />
          </div>
        ) : null}
        {blocked ? <p className="mt-2 text-xs font-semibold text-danger-500">Hatalar düzelmeden taslak kaydedilemez ve yayınlanamaz.</p> : null}
        {msg ? (
          <p role={msg.kind === "error" ? "alert" : "status"} className={`mt-2 flex items-center gap-1.5 text-xs font-semibold ${msg.kind === "error" ? "text-danger-500" : "text-mint-700"}`}>
            {msg.kind === "error" ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
            {msg.text}
          </p>
        ) : null}
      </section>

      <MenuPreview cfg={cfg} />

      <div role="tablist" aria-label="Site menüsü bölümleri" className="flex flex-wrap gap-1.5 border-b border-line pb-2">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`sm-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`sm-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            type="button"
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={`focus-ring rounded-[var(--radius-control)] px-3.5 py-2 text-sm font-bold transition ${tab === t.id ? "bg-brand-600 text-white" : "text-text-muted hover:text-ink-950"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`sm-panel-${tab}`} aria-labelledby={`sm-tab-${tab}`} tabIndex={0} className="focus-ring rounded-[var(--radius-card)]">
        {tab === "menu" ? <MenuTab cfg={cfg} update={update} issues={issues} media={media} addMedia={addMedia} readOnly={readOnly} /> : null}
        {tab === "footer" ? <FooterTab cfg={cfg} update={update} issues={issues} readOnly={readOnly} /> : null}
        {tab === "announcement" ? <AnnouncementTab cfg={cfg} update={update} issues={issues} readOnly={readOnly} /> : null}
        {tab === "versions" ? (
          <section className="space-y-3" aria-label="Sürüm geçmişi">
            <p className="text-xs text-text-muted">Her yayın bir sürüm olarak saklanır (son 10). Bir sürüme dönmek onu yeni bir sürüm olarak canlıya alır; hiçbir kayıt silinmez.</p>
            {history.length === 0 ? (
              <p className="rounded-[var(--radius-card)] border border-dashed border-line p-6 text-center text-sm text-text-muted">
                Henüz yayın yapılmadı; site varsayılan menüyle çalışıyor.
              </p>
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
                      <p className="text-xs text-text-muted">{h.atLabel} · {h.by || "—"} · {h.groups} grup, {h.items} bağlantı</p>
                    </div>
                    {!readOnly ? (
                      <InlineConfirm label="Bu sürüme dön" confirmLabel="Evet, canlıya al" disabled={pending} icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={() => rollback(h.id)} />
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
                <span>
                  <span className="uppercase tracking-wide">{i.level === "error" ? "Hata" : "Uyarı"}</span> · {i.message}
                </span>
              </li>
            ))}
            {issues.length > 40 ? <li className="text-xs text-text-muted">… ve {issues.length - 40} sorun daha.</li> : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
