"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ANNOUNCEMENT_BAR_BG } from "@/lib/brand/og-theme";
import { now } from "@/lib/clock";
import { endOfDayTrMs, pickAnnouncement, startOfDayTrMs } from "@/lib/site-menu/announcements";
import { allIds, blankFooterColumn, blankFooterLink, moveInArray, newId } from "@/lib/site-menu/editor-model";
import { toPublicAnnouncements } from "@/lib/site-menu/public";
import { ANNOUNCEMENT_PATH_MODES, LIMITS, type AnnouncementPathMode, type Issue } from "@/lib/site-menu/schema-core";
import type { AnnouncementItem, SiteMenuConfig } from "@/lib/site-menu/schema";
import { Field, FieldIssue, InlineConfirm } from "./editor-ui";
import { UtmBuilder, selectCls } from "./frame-tabs";
import type { Update } from "./menu-tab";

type Props = { cfg: SiteMenuConfig; update: Update; issues: readonly Issue[]; readOnly: boolean };

export function FooterTab({ cfg, update, issues, readOnly }: Props) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">Sitenin alt bilgi bağlantı sütunları. Marka metni, güven rozetleri, düğme ve yasal satır “Alt bilgi marka bloğu” sekmesindedir.</p>
      {cfg.footer.map((c, ci) => {
        const cp = `footer.${ci}`;
        return (
          <section key={c.id} className={`rounded-[var(--radius-panel)] border bg-surface p-4 ${c.hidden ? "border-dashed border-line opacity-80" : "border-line"}`} aria-label={`Sütun: ${c.title}`}>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[10rem] flex-1">
                <Field label="Sütun başlığı">
                  <Input value={c.title} disabled={readOnly} onChange={(e) => update((d) => { d.footer[ci].title = e.target.value; })} />
                  <FieldIssue issues={issues} path={`${cp}.title`} />
                </Field>
              </div>
              <div className="flex items-center gap-1">
                <Button type="button" variant="outline" size="icon" disabled={readOnly || ci === 0} aria-label="Sütunu sola taşı" onClick={() => update((d) => { d.footer = moveInArray(d.footer, ci, ci - 1); })}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                <Button type="button" variant="outline" size="icon" disabled={readOnly || ci === cfg.footer.length - 1} aria-label="Sütunu sağa taşı" onClick={() => update((d) => { d.footer = moveInArray(d.footer, ci, ci + 1); })}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                <Button type="button" variant="outline" size="icon" disabled={readOnly} aria-pressed={c.hidden} aria-label={c.hidden ? "Sütunu göster" : "Sütunu gizle"} onClick={() => update((d) => { d.footer[ci].hidden = !d.footer[ci].hidden; })}>
                  {c.hidden ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                </Button>
                <InlineConfirm label="Sütunu sil" confirmLabel="Evet, sil" tone="danger" disabled={readOnly} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={() => update((d) => { d.footer.splice(ci, 1); })} />
              </div>
            </div>
            <FieldIssue issues={issues} path={cp} />
            <label className="mt-2 flex items-center gap-2 text-sm font-semibold text-ink-950">
              <input type="checkbox" className="h-4 w-4" checked={c.autoPlans} disabled={readOnly} onChange={(e) => update((d) => { d.footer[ci].autoPlans = e.target.checked; })} />
              Otomatik (planlardan): paket bağlantıları etkin paket tanımlarından eklenir
            </label>
            <ul className="mt-3 space-y-2" aria-label={`${c.title} bağlantıları`}>
              {c.links.map((l, li) => {
                const lp = `${cp}.links.${li}`;
                return (
                  <li key={l.id} className={`flex flex-wrap items-start gap-2 rounded-[var(--radius-card)] border border-line p-2 ${l.hidden ? "opacity-70" : ""}`}>
                    <div className="grid min-w-[10rem] flex-1 gap-2 sm:grid-cols-2">
                      <Field label="Ad">
                        <Input value={l.label} disabled={readOnly} onChange={(e) => update((d) => { d.footer[ci].links[li].label = e.target.value; })} />
                        <FieldIssue issues={issues} path={`${lp}.label`} />
                      </Field>
                      <Field label="Hedef (yol veya adres)">
                        <Input list="site-menu-targets" value={l.href} disabled={readOnly} onChange={(e) => update((d) => { d.footer[ci].links[li].href = e.target.value; })} />
                        <FieldIssue issues={issues} path={`${lp}.href`} />
                      </Field>
                    </div>
                    <div className="flex items-center gap-1 pt-5">
                      <Button type="button" variant="outline" size="icon" disabled={readOnly || li === 0} aria-label="Yukarı taşı" onClick={() => update((d) => { d.footer[ci].links = moveInArray(d.footer[ci].links, li, li - 1); })}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                      <Button type="button" variant="outline" size="icon" disabled={readOnly || li === c.links.length - 1} aria-label="Aşağı taşı" onClick={() => update((d) => { d.footer[ci].links = moveInArray(d.footer[ci].links, li, li + 1); })}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                      <Button type="button" variant="outline" size="icon" disabled={readOnly} aria-pressed={l.hidden} aria-label={l.hidden ? "Göster" : "Gizle"} onClick={() => update((d) => { d.footer[ci].links[li].hidden = !d.footer[ci].links[li].hidden; })}>
                        {l.hidden ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                      </Button>
                      <InlineConfirm label="Sil" confirmLabel="Evet, sil" tone="danger" disabled={readOnly} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={() => update((d) => { d.footer[ci].links.splice(li, 1); })} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex items-center gap-2">
              <Button type="button" variant="primary" size="sm" disabled={readOnly || c.links.length >= LIMITS.maxFooterLinksPerColumn} onClick={() => update((d) => { d.footer[ci].links.push(blankFooterLink(newId("fl", allIds(d)))); })}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Bağlantı ekle
              </Button>
              <span className="text-xs text-text-faint">{c.links.length}/{LIMITS.maxFooterLinksPerColumn}</span>
            </div>
          </section>
        );
      })}
      <div className="flex items-center gap-2">
        <Button type="button" variant="primary" size="sm" disabled={readOnly || cfg.footer.length >= LIMITS.maxFooterColumns} onClick={() => update((d) => { d.footer.push(blankFooterColumn(newId("fk", allIds(d)))); })}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Sütun ekle
        </Button>
        <span className="text-xs text-text-faint">{cfg.footer.length}/{LIMITS.maxFooterColumns}</span>
      </div>
    </div>
  );
}

const PATH_LABELS: Record<AnnouncementPathMode, string> = { all: "Bütün site", home: "Yalnız ana sayfa", prefix: "Belirli yol ve altı" };

function blankAnnouncement(id: string): AnnouncementItem {
  return { id, text: "Yeni duyuru", href: "", linkLabel: "", startsOn: "", endsOn: "", pathMode: "all", pathPrefix: "", priority: 5, dismissible: true };
}

/** Kaydın bugünkü durumu (Türkiye günü): editörde rozet olarak gösterilir. */
function statusOf(a: AnnouncementItem, nowMs: number): { label: string; cls: string } {
  const start = startOfDayTrMs(a.startsOn);
  const end = endOfDayTrMs(a.endsOn);
  if (end !== null && nowMs > end) return { label: "Süresi doldu", cls: "bg-ink-950/6 text-text-muted" };
  if (start !== null && nowMs < start) return { label: `${a.startsOn} tarihinde başlar`, cls: "bg-amber-100 text-amber-900" };
  return { label: "Yayın aralığında", cls: "bg-mint-500/15 text-mint-700" };
}

export function AnnouncementTab({ cfg, update, issues, readOnly }: Props) {
  const list = cfg.announcements;
  const [previewPath, setPreviewPath] = useState("/");
  const nowMs = now();
  const picked = pickAnnouncement(toPublicAnnouncements(list, nowMs), previewPath || "/", nowMs);
  const set = (i: number, fn: (x: AnnouncementItem) => void) => update((d) => fn(d.announcements[i]));
  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">
        Sitenin en üstündeki ince şerit. En çok {LIMITS.maxAnnouncements} duyuru tanımlanır; her sayfada tarihi uyan, yola uyan ve kapatılmamış duyurular içinde
        en yüksek öncelikli TEK duyuru görünür (eşitlikte listedeki sıra). Tarihler Türkiye günüyle değerlendirilir. Ziyaretçi kapatırsa metin, bağlantı veya
        tarih değişene kadar o duyuru yeniden görünmez.
      </p>

      <section className="space-y-2 rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-label="Duyuru önizlemesi">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56">
            <Field label="Önizleme yolu">
              <Input list="site-menu-targets" value={previewPath} onChange={(e) => setPreviewPath(e.target.value)} placeholder="/" />
            </Field>
          </div>
          <p className="pb-2 text-xs text-text-muted">Bu yolda bugün görünecek duyuru:</p>
        </div>
        {picked ? (
          <div className="flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-card)] px-12 py-1.5 text-center text-sm font-semibold text-white" style={{ background: ANNOUNCEMENT_BAR_BG }}>
            <p className="m-0">
              {picked.text}
              {picked.href ? <> <span className="font-extrabold underline underline-offset-[3px]">{picked.linkLabel}</span></> : null}
            </p>
          </div>
        ) : (
          <p className="rounded-[var(--radius-card)] border border-dashed border-line p-3 text-center text-xs text-text-muted">Bu yolda bugün görünen duyuru yok.</p>
        )}
      </section>

      {list.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line p-6 text-center text-sm text-text-muted">
          Duyuru yok; şerit sitede görünmüyor. Bir kampanya, bakım ya da yeni özellik için duyuru ekleyin.
        </p>
      ) : null}

      {list.map((a, i) => {
        const p = `announcements.${i}`;
        const st = statusOf(a, nowMs);
        return (
          <section key={a.id} className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-label={`Duyuru ${i + 1}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink-950">
                Duyuru {i + 1}
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${st.cls}`}>{st.label}</span>
                {picked && picked.id.startsWith(`${a.id}-`) ? <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-bold text-brand-700">Önizleme yolunda görünen</span> : null}
              </p>
              <div className="flex items-center gap-1">
                <Button type="button" variant="outline" size="icon" disabled={readOnly || i === 0} aria-label="Yukarı taşı" onClick={() => update((d) => { d.announcements = moveInArray(d.announcements, i, i - 1); })}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                <Button type="button" variant="outline" size="icon" disabled={readOnly || i === list.length - 1} aria-label="Aşağı taşı" onClick={() => update((d) => { d.announcements = moveInArray(d.announcements, i, i + 1); })}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                <InlineConfirm label="Sil" confirmLabel="Evet, sil" tone="danger" disabled={readOnly} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={() => update((d) => { d.announcements.splice(i, 1); })} />
              </div>
            </div>
            <FieldIssue issues={issues} path={`${p}.id`} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label={`Metin (en çok ${LIMITS.announcementItemText} karakter, düz metin)`}>
                  <Input value={a.text} disabled={readOnly} onChange={(e) => set(i, (x) => { x.text = e.target.value; })} />
                  <FieldIssue issues={issues} path={`${p}.text`} />
                </Field>
              </div>
              <Field label="Bağlantı (isteğe bağlı; site yolu veya https)">
                <Input list="site-menu-targets" value={a.href} disabled={readOnly} onChange={(e) => set(i, (x) => { x.href = e.target.value; })} placeholder="/fiyatlar veya https://..." />
                <FieldIssue issues={issues} path={`${p}.href`} />
              </Field>
              <Field label="Bağlantı metni">
                <Input value={a.linkLabel} disabled={readOnly} onChange={(e) => set(i, (x) => { x.linkLabel = e.target.value; })} placeholder="Detaylar" />
                <FieldIssue issues={issues} path={`${p}.linkLabel`} />
              </Field>
              <div className="sm:col-span-2">
                <UtmBuilder href={a.href || "/"} disabled={readOnly} onApply={(h) => set(i, (x) => { x.href = h; })} />
              </div>
              <Field label="Başlangıç tarihi (isteğe bağlı)" hint="O günün başından (Türkiye saati) itibaren.">
                <Input type="date" value={a.startsOn} disabled={readOnly} onChange={(e) => set(i, (x) => { x.startsOn = e.target.value; })} />
                <FieldIssue issues={issues} path={`${p}.startsOn`} />
              </Field>
              <Field label="Bitiş tarihi (isteğe bağlı)" hint="O günün sonuna (Türkiye saati) kadar.">
                <Input type="date" value={a.endsOn} disabled={readOnly} onChange={(e) => set(i, (x) => { x.endsOn = e.target.value; })} />
                <FieldIssue issues={issues} path={`${p}.endsOn`} />
              </Field>
              <Field label="Nerede görünsün">
                <select className={selectCls} value={a.pathMode} disabled={readOnly} onChange={(e) => set(i, (x) => { x.pathMode = e.target.value as AnnouncementPathMode; })}>
                  {ANNOUNCEMENT_PATH_MODES.map((m) => (
                    <option key={m} value={m}>{PATH_LABELS[m]}</option>
                  ))}
                </select>
              </Field>
              {a.pathMode === "prefix" ? (
                <Field label="Yol öneki" hint="Ör. /fiyatlar: /fiyatlar ve altındaki sayfalar.">
                  <Input list="site-menu-targets" value={a.pathPrefix} disabled={readOnly} onChange={(e) => set(i, (x) => { x.pathPrefix = e.target.value; })} placeholder="/fiyatlar" />
                  <FieldIssue issues={issues} path={`${p}.pathPrefix`} />
                </Field>
              ) : (
                <div className="hidden sm:block" />
              )}
              <Field label="Öncelik (9 en yüksek)">
                <select className={selectCls} value={a.priority} disabled={readOnly} onChange={(e) => set(i, (x) => { x.priority = Number(e.target.value); })}>
                  {[9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold text-ink-950">
                <input type="checkbox" className="h-4 w-4" checked={a.dismissible} disabled={readOnly} onChange={(e) => set(i, (x) => { x.dismissible = e.target.checked; })} />
                Ziyaretçi kapatabilsin
              </label>
            </div>
          </section>
        );
      })}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={readOnly || list.length >= LIMITS.maxAnnouncements}
          onClick={() => update((d) => { d.announcements.push(blankAnnouncement(newId("an", new Set(d.announcements.map((x) => x.id))))); })}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Duyuru ekle
        </Button>
        <span className="text-xs text-text-faint">{list.length}/{LIMITS.maxAnnouncements}</span>
      </div>
    </div>
  );
}
