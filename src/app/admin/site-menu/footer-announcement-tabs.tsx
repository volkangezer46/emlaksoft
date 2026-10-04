"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { allIds, blankFooterColumn, blankFooterLink, moveInArray, newId } from "@/lib/site-menu/editor-model";
import { LIMITS, type Issue, type SiteMenuConfig } from "@/lib/site-menu/schema";
import { Field, FieldIssue, InlineConfirm, btnPrimary, iconBtn } from "./editor-ui";
import type { Update } from "./menu-tab";

type Props = { cfg: SiteMenuConfig; update: Update; issues: readonly Issue[]; readOnly: boolean };

export function FooterTab({ cfg, update, issues, readOnly }: Props) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">Sitenin alt bilgi bağlantı sütunları. Marka metni, güven rozetleri ve yasal satır sabit kalır.</p>
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
                <button type="button" className={iconBtn} disabled={readOnly || ci === 0} aria-label="Sütunu sola taşı" onClick={() => update((d) => { d.footer = moveInArray(d.footer, ci, ci - 1); })}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" className={iconBtn} disabled={readOnly || ci === cfg.footer.length - 1} aria-label="Sütunu sağa taşı" onClick={() => update((d) => { d.footer = moveInArray(d.footer, ci, ci + 1); })}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" className={iconBtn} disabled={readOnly} aria-pressed={c.hidden} aria-label={c.hidden ? "Sütunu göster" : "Sütunu gizle"} onClick={() => update((d) => { d.footer[ci].hidden = !d.footer[ci].hidden; })}>
                  {c.hidden ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                </button>
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
                      <button type="button" className={iconBtn} disabled={readOnly || li === 0} aria-label="Yukarı taşı" onClick={() => update((d) => { d.footer[ci].links = moveInArray(d.footer[ci].links, li, li - 1); })}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                      <button type="button" className={iconBtn} disabled={readOnly || li === c.links.length - 1} aria-label="Aşağı taşı" onClick={() => update((d) => { d.footer[ci].links = moveInArray(d.footer[ci].links, li, li + 1); })}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                      <button type="button" className={iconBtn} disabled={readOnly} aria-pressed={l.hidden} aria-label={l.hidden ? "Göster" : "Gizle"} onClick={() => update((d) => { d.footer[ci].links[li].hidden = !d.footer[ci].links[li].hidden; })}>
                        {l.hidden ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                      </button>
                      <InlineConfirm label="Sil" confirmLabel="Evet, sil" tone="danger" disabled={readOnly} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={() => update((d) => { d.footer[ci].links.splice(li, 1); })} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" className={btnPrimary} disabled={readOnly || c.links.length >= LIMITS.maxFooterLinksPerColumn} onClick={() => update((d) => { d.footer[ci].links.push(blankFooterLink(newId("fl", allIds(d)))); })}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Bağlantı ekle
              </button>
              <span className="text-xs text-text-faint">{c.links.length}/{LIMITS.maxFooterLinksPerColumn}</span>
            </div>
          </section>
        );
      })}
      <div className="flex items-center gap-2">
        <button type="button" className={btnPrimary} disabled={readOnly || cfg.footer.length >= LIMITS.maxFooterColumns} onClick={() => update((d) => { d.footer.push(blankFooterColumn(newId("fk", allIds(d)))); })}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Sütun ekle
        </button>
        <span className="text-xs text-text-faint">{cfg.footer.length}/{LIMITS.maxFooterColumns}</span>
      </div>
    </div>
  );
}

export function AnnouncementTab({ cfg, update, issues, readOnly }: Props) {
  const a = cfg.announcement;
  const set = (fn: (x: SiteMenuConfig["announcement"]) => void) => update((d) => fn(d.announcement));
  return (
    <section className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-label="Duyuru şeridi">
      <p className="text-xs text-text-muted">Sitenin en üstünde görünen ince şerit. Bitiş tarihi geçince kendiliğinden kalkar; ziyaretçi kapatırsa metin değişene kadar yeniden görünmez.</p>
      <label className="flex items-center gap-2 text-sm font-semibold text-ink-950">
        <input type="checkbox" className="h-4 w-4" checked={a.enabled} disabled={readOnly} onChange={(e) => set((x) => { x.enabled = e.target.checked; })} />
        Duyuru şeridini göster
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={`Metin (en çok ${LIMITS.announcementText} karakter)`}>
            <Input value={a.text} disabled={readOnly} onChange={(e) => set((x) => { x.text = e.target.value; })} />
            <FieldIssue issues={issues} path="announcement.text" />
          </Field>
        </div>
        <Field label="Bağlantı (isteğe bağlı)">
          <Input list="site-menu-targets" value={a.href} disabled={readOnly} onChange={(e) => set((x) => { x.href = e.target.value; })} placeholder="/fiyatlar veya https://..." />
          <FieldIssue issues={issues} path="announcement.href" />
        </Field>
        <Field label="Bağlantı metni">
          <Input value={a.linkLabel} disabled={readOnly} onChange={(e) => set((x) => { x.linkLabel = e.target.value; })} placeholder="Detaylar" />
          <FieldIssue issues={issues} path="announcement.linkLabel" />
        </Field>
        <Field label="Bitiş tarihi (isteğe bağlı)" hint="O günün sonuna (Türkiye saati) kadar gösterilir.">
          <Input type="date" value={a.endsOn} disabled={readOnly} onChange={(e) => set((x) => { x.endsOn = e.target.value; })} />
          <FieldIssue issues={issues} path="announcement.endsOn" />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold text-ink-950">
          <input type="checkbox" className="h-4 w-4" checked={a.dismissible} disabled={readOnly} onChange={(e) => set((x) => { x.dismissible = e.target.checked; })} />
          Ziyaretçi kapatabilsin
        </label>
      </div>
    </section>
  );
}
