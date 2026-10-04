"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, FileUp } from "lucide-react";
import { applyGeoImport, previewGeoImport, type GeoImportPreview, type ImportItem } from "@/app/actions/geo-admin";

const TEMPLATE_CSV = [
  "plate_code,province,district,neighborhood,source_id,postal_code,lat,lng,population",
  "34,İstanbul,,,,,41.0082,28.9784,",
  "34,İstanbul,Kadıköy,,1234,,40.99,29.03,",
  "34,İstanbul,Kadıköy,Caferağa Mahallesi,56789,34710,,,",
].join("\n");

const field = "rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-400";
const KIND_LABEL: Record<ImportItem["kind"], string> = { add: "Eklenecek", change: "Değişecek", deactivate: "Pasife alınacak" };
const LEVEL_LABEL = { province: "İl", district: "İlçe", neighborhood: "Mahalle" } as const;

export function ImportPanel({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<GeoImportPreview | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [kind, setKind] = useState<ImportItem["kind"] | "all">("all");

  const form = () => new FormData(formRef.current ?? undefined);

  function dryRun() {
    setResult(null);
    start(async () => setPreview(await previewGeoImport(form())));
  }
  function apply() {
    start(async () => {
      const f = form();
      if (confirmed) f.set("confirm", "on");
      const r = await applyGeoImport(f);
      if (r.ok) {
        setResult({ ok: true, text: r.message ?? "Uygulandı." });
        setPreview(null);
        setConfirmed(false);
        router.refresh();
      } else setResult({ ok: false, text: r.error ?? "Uygulanamadı." });
    });
  }
  function template() {
    const url = URL.createObjectURL(new Blob(["﻿" + TEMPLATE_CSV], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "cografya-sablon.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const s = preview?.summary;
  const items = (preview?.items ?? []).filter((i) => kind === "all" || i.kind === kind);

  return (
    <div className="space-y-5">
      <form ref={formRef} onSubmit={(e) => { e.preventDefault(); dryRun(); }} className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <FileUp className="h-4 w-4 text-brand-600" />
            <input type="file" name="file" accept=".csv,.json,text/csv,application/json" aria-label="CSV veya JSON dosyası" className="text-xs" />
          </label>
          <select name="mode" defaultValue="merge" aria-label="Kipi" className={field}>
            <option value="merge">Birleştir (yalnız ekle/güncelle)</option>
            <option value="full">Tam kaynak (olmayanları pasife al; 81 il şart)</option>
          </select>
          <button type="button" onClick={template} className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 py-2 text-xs font-semibold text-text-muted hover:border-brand-400">
            <Download className="h-3.5 w-3.5" /> CSV şablonu
          </button>
        </div>
        <textarea name="pasted" rows={4} aria-label="Ya da içeriği yapıştırın" placeholder="…ya da CSV/JSON içeriğini buraya yapıştırın" className={`${field} w-full font-mono text-xs`} />
        <div className="flex flex-wrap items-center gap-2">
          <input name="source" placeholder="Kaynak (örn. turkiyeapi-v2)" aria-label="Kaynak" className={`${field} w-56`} />
          <input name="version" placeholder="Kaynak sürümü" aria-label="Kaynak sürümü" className={`${field} w-40`} />
          <input name="date" type="date" aria-label="Kaynak tarihi" className={field} />
          <button type="submit" disabled={pending} className="rounded-[var(--radius-control)] bg-ink-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {pending ? "Çalışıyor…" : "Kuru çalıştır"}
          </button>
        </div>
        <p className="text-xs text-text-muted">
          Kuru çalıştırma hiçbir şey yazmaz. Silme yoktur: kaynakta olmayan kayıtlar (yalnız Tam kaynak kipinde) pasife alınır; pasif kayıtlar yeniden açılmaz. 3 MB üstü kaynaklar için <code>npm run geo:import</code>.
        </p>
      </form>

      {result ? (
        <p role={result.ok ? "status" : "alert"} className={`flex items-center gap-2 rounded-[var(--radius-card)] border px-4 py-3 text-sm ${result.ok ? "border-success-500/30 text-success-600" : "border-danger-500/30 text-danger-500"}`}>
          {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />} {result.text}
        </p>
      ) : null}

      {preview?.error ? <p role="alert" className="text-sm text-danger-500">{preview.error}</p> : null}
      {preview?.errors?.length ? (
        <ul className="space-y-1 rounded-[var(--radius-card)] border border-danger-500/30 p-4 text-xs text-danger-500">
          {preview.errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      ) : null}
      {preview?.warnings?.length ? (
        <details className="rounded-[var(--radius-card)] border border-amber-300/50 p-4 text-xs text-amber-800">
          <summary className="cursor-pointer font-semibold">{preview.warnings.length} uyarı</summary>
          <ul className="mt-2 space-y-1">{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      ) : null}

      {s ? (
        <section className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <h2 className="font-display text-lg font-bold">Fark özeti · {preview?.rowCount?.toLocaleString("tr-TR")} satır</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            {([
              ["add", "Eklenecek", s.add],
              ["change", "Değişecek", s.change],
              ["deactivate", "Pasife alınacak", s.deactivate],
            ] as const).map(([k, label, c]) => (
              <button key={k} type="button" onClick={() => setKind(kind === k ? "all" : k)} aria-pressed={kind === k} className={`rounded-[var(--radius-card)] border p-3 text-left transition hover:border-brand-400 ${kind === k ? "border-brand-400" : "border-line"}`}>
                <p className="text-xs font-semibold text-text-muted">{label}</p>
                <p className="font-display text-xl font-extrabold">{(c.province + c.district + c.neighborhood).toLocaleString("tr-TR")}</p>
                <p className="text-xs text-text-muted">{c.province} il · {c.district} ilçe · {c.neighborhood.toLocaleString("tr-TR")} mahalle</p>
              </button>
            ))}
            <div className="rounded-[var(--radius-card)] border border-line p-3">
              <p className="text-xs font-semibold text-text-muted">Değişmeyen</p>
              <p className="font-display text-xl font-extrabold">{s.unchanged.toLocaleString("tr-TR")}</p>
              <p className="text-xs text-text-muted">{s.skippedInactive} pasif kayıt atlandı</p>
            </div>
          </div>

          <ul className="max-h-96 divide-y divide-line overflow-y-auto rounded-[var(--radius-card)] border border-line text-sm">
            {items.map((i, idx) => (
              <li key={idx} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-bold text-text-muted">{KIND_LABEL[i.kind]}</span>
                <span className="text-xs text-text-muted">{LEVEL_LABEL[i.level]}</span>
                {i.href ? <Link href={i.href} className="font-semibold hover:text-brand-600 hover:underline">{i.path}</Link> : <span className="font-semibold">{i.path}</span>}
                {i.detail ? <span className="text-xs text-text-muted">{i.detail}</span> : null}
              </li>
            ))}
            {items.length === 0 ? <li className="px-3 py-6 text-center text-xs text-text-muted">Bu türde kayıt yok.</li> : null}
          </ul>
          {preview?.itemsTruncated ? <p className="text-xs text-text-muted">Liste her türde ilk 400 kayıtla sınırlı; sayılar tamdır.</p> : null}

          {canWrite ? (
            preview?.canApply ? (
              <div className="space-y-2 border-t border-line pt-3">
                {preview.versionsReady === false ? (
                  <p role="alert" className="text-xs text-danger-500">Sürüm tablosu bu ortamda yok (geo migration uygulanmamış): geri alınamayan toplu yazım yapılmaz, uygulama kapalı.</p>
                ) : null}
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  Bu farkı uygulamak istiyorum (partilerle yazılır; Sürümler ekranından geri alınabilir).
                </label>
                <button type="button" onClick={apply} disabled={pending || preview.versionsReady === false} className="rounded-[var(--radius-control)] bg-danger-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
                  {pending ? "Uygulanıyor…" : "Uygula"}
                </button>
              </div>
            ) : (
              <p className="border-t border-line pt-3 text-xs text-text-muted">{preview?.errors?.length ? "Hatalar giderilmeden uygulanamaz." : "Uygulanacak fark yok."}</p>
            )
          ) : (
            <p className="border-t border-line pt-3 text-xs text-text-muted">Uygulama yalnız süper admin içindir; bu ekran sizin için salt okunur önizlemedir.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
