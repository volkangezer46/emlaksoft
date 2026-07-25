"use client";

import { useState, useTransition } from "react";
import {
  Clock, FileCheck2, History, Loader2, RadioTower, Send, Shield,
} from "lucide-react";
import {
  getPropertyStatusHistory,
  updatePropertyAuthorization,
} from "@/app/actions/property-management";
import { publishPropertyToPortal } from "@/app/actions/portal-publish";
import type { PortalName } from "@/lib/integrations/portals";
import { DAY_MS, msUntil } from "@/lib/clock";

// ---------------------------------------------------------------------------
// Durum geçmişi paneli
// ---------------------------------------------------------------------------

type HistoryRow = {
  id: string;
  old_status: string | null;
  new_status: string;
  reason: string | null;
  created_at: string;
  changed_by: { full_name?: string } | { full_name?: string }[] | null;
};

function authorName(p: HistoryRow["changed_by"]) {
  if (!p) return "Sistem";
  return Array.isArray(p) ? p[0]?.full_name ?? "—" : p.full_name ?? "—";
}

function relTime(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return "Bugün";
  if (d === 1) return "Dün";
  return `${d} gün önce`;
}

export function PropertyStatusHistory({
  propertyId,
  initialHistory,
}: {
  propertyId: string;
  initialHistory: HistoryRow[];
}) {
  const [history, setHistory] = useState(initialHistory);
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();

  function refresh() {
    start(async () => {
      const data = await getPropertyStatusHistory(propertyId);
      setHistory(data as HistoryRow[]);
    });
  }

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5">
      <button
        type="button"
        onClick={() => { setOpen((s) => !s); if (!open) refresh(); }}
        className="flex w-full items-center justify-between"
      >
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <History className="h-4 w-4 text-brand-600" /> Durum geçmişi
          {history.length > 0 && (
            <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[10px] font-bold text-brand-600">{history.length}</span>
          )}
        </h2>
        <Clock className={`h-4 w-4 text-text-faint transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-4 space-y-2">
          {history.length === 0 ? (
            <p className="text-center text-sm text-text-muted py-4">Henüz durum değişikliği yok.</p>
          ) : history.map((h) => (
            <div key={h.id} className="flex items-start gap-3 rounded-[12px] border border-line bg-canvas/50 px-3 py-3">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-brand-600/8 text-brand-600">
                <History className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-ink-950">
                  {h.old_status ? `${h.old_status} → ` : ""}{h.new_status}
                </p>
                {h.reason && <p className="mt-0.5 text-xs text-text-muted">{h.reason}</p>}
                <p className="mt-0.5 text-[10px] text-text-faint">{authorName(h.changed_by)} · {relTime(h.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Yetki belgesi paneli
// ---------------------------------------------------------------------------

export function PropertyAuthorizationPanel({
  propertyId,
  initial,
}: {
  propertyId: string;
  initial: {
    authStart?: string | null;
    authEnd?: string | null;
    authType?: string | null;
    authNotes?: string | null;
  };
}) {
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<{ ok?: boolean; error?: string } | null>(null);
  const [saving, start] = useTransition();

  const daysLeft = initial.authEnd
    ? Math.floor(msUntil(initial.authEnd) / DAY_MS)
    : null;

  const urgency = daysLeft !== null
    ? daysLeft < 0 ? "expired" : daysLeft <= 7 ? "critical" : daysLeft <= 15 ? "warning" : "ok"
    : "none";

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await updatePropertyAuthorization(propertyId, {
        authStart: String(fd.get("auth_start") ?? ""),
        authEnd:   String(fd.get("auth_end")   ?? ""),
        authType:  String(fd.get("auth_type")  ?? ""),
        authNotes: String(fd.get("auth_notes") ?? ""),
      });
      setResult(res);
      if (res.ok) setEditing(false);
    });
  }

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <FileCheck2 className="h-4 w-4 text-amber-600" /> Yetki belgesi
        </h2>
        {urgency === "expired"  && <span className="rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-600">Süresi doldu</span>}
        {urgency === "critical" && <span className="rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-600">{daysLeft} gün kaldı</span>}
        {urgency === "warning"  && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-600">{daysLeft} gün kaldı</span>}
        {urgency === "ok"       && <span className="rounded-full bg-mint-500/10 px-2.5 py-1 text-[10px] font-bold text-mint-700">{daysLeft} gün kaldı</span>}
        <button type="button" onClick={() => setEditing((s) => !s)} className="text-xs font-semibold text-brand-600 hover:underline">
          {editing ? "İptal" : "Düzenle"}
        </button>
      </div>

      {!editing ? (
        <div className="mt-3 space-y-1 text-sm text-text-muted">
          {initial.authStart && <p>Başlangıç: <span className="font-semibold text-ink-950">{new Date(initial.authStart).toLocaleDateString("tr-TR")}</span></p>}
          {initial.authEnd   && <p>Bitiş:     <span className="font-semibold text-ink-950">{new Date(initial.authEnd).toLocaleDateString("tr-TR")}</span></p>}
          {initial.authType  && <p>Tür:       <span className="font-semibold text-ink-950">{initial.authType === "exclusive" ? "Tek Yetkili" : initial.authType === "open" ? "Açık Yetki" : "Sınırlı Yetki"}</span></p>}
          {initial.authNotes && <p className="mt-1 text-xs">{initial.authNotes}</p>}
          {!initial.authStart && !initial.authEnd && (
            <p className="text-text-faint">Yetki belgesi bilgisi girilmemiş.</p>
          )}
        </div>
      ) : (
        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-950">Başlangıç</label>
              <input name="auth_start" type="date" defaultValue={initial.authStart ?? ""} className="w-full rounded-[9px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-950">Bitiş</label>
              <input name="auth_end" type="date" defaultValue={initial.authEnd ?? ""} className="w-full rounded-[9px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-ink-950">Yetki türü</label>
              <select name="auth_type" defaultValue={initial.authType ?? ""} className="w-full appearance-none rounded-[9px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300">
                <option value="">— Seçin —</option>
                <option value="exclusive">Tek Yetkili</option>
                <option value="open">Açık Yetki</option>
                <option value="limited">Sınırlı Yetki</option>
              </select>
            </div>
          </div>
          <textarea name="auth_notes" rows={2} defaultValue={initial.authNotes ?? ""} placeholder="Not (opsiyonel)" className="w-full resize-none rounded-[9px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300" />
          {result?.error && <p className="text-xs text-red-600">{result.error}</p>}
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-[9px] bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50">
            <Shield className="h-3.5 w-3.5" /> {saving ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </form>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// P1-4: Çoklu portal yayın butonu
// ---------------------------------------------------------------------------

const PORTALS: { name: PortalName; label: string }[] = [
  { name: "sahibinden", label: "Sahibinden.com" },
  { name: "hepsiemlak", label: "Hepsiemlak" },
  { name: "zingat",     label: "Zingat" },
];

export function PublishToPortalsPanel({
  propertyId,
  configuredPortals,
}: {
  propertyId: string;
  configuredPortals: PortalName[];
}) {
  const [results, setResults] = useState<Record<string, { ok?: boolean; error?: string }>>({});
  const [publishingAll, startAll] = useTransition();
  const [, startOne] = useTransition();

  function handlePublish(portalName: PortalName) {
    startOne(async () => {
      const res = await publishPropertyToPortal(propertyId, portalName);
      setResults((prev) => ({ ...prev, [portalName]: res }));
    });
  }

  function handlePublishAll() {
    startAll(async () => {
      const portalsToPublish = PORTALS.filter((p) => configuredPortals.includes(p.name));
      const settled = await Promise.allSettled(
        portalsToPublish.map((p) => publishPropertyToPortal(propertyId, p.name)),
      );
      const next: Record<string, { ok?: boolean; error?: string }> = {};
      portalsToPublish.forEach((p, i) => {
        const r = settled[i];
        next[p.name] = r.status === "fulfilled" ? r.value : { error: "Hata oluştu" };
      });
      setResults(next);
    });
  }

  if (configuredPortals.length === 0) return null;

  const successCount = Object.values(results).filter((r) => r.ok).length;

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <RadioTower className="h-4 w-4 text-brand-600" /> Portale Yayınla
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            API entegrasyonu yapılandırılmış {configuredPortals.length} portale tek tıkla gönder.
          </p>
        </div>
        {configuredPortals.length > 1 && (
          <button
            type="button"
            onClick={handlePublishAll}
            disabled={publishingAll}
            className="btn-shine inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {publishingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Tümüne yayınla
          </button>
        )}
      </div>

      {successCount > 0 && (
        <p className="mt-3 rounded-[10px] bg-mint-500/10 px-3 py-2 text-xs font-semibold text-mint-600">
          ✓ {successCount} portale başarıyla gönderildi.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {PORTALS.filter((p) => configuredPortals.includes(p.name)).map((p) => {
          const res = results[p.name];
          return (
            <div key={p.name} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handlePublish(p.name)}
                disabled={publishingAll}
                className={`inline-flex items-center gap-1.5 rounded-[9px] border px-3 py-2 text-xs font-semibold transition disabled:opacity-50 ${
                  res?.ok
                    ? "border-mint-500/30 bg-mint-500/8 text-mint-600"
                    : "border-line bg-canvas text-brand-600 hover:bg-brand-600/5 hover:border-brand-300"
                }`}
              >
                <Send className="h-3.5 w-3.5" /> {p.label}
                {res?.ok && " ✓"}
              </button>
              {res?.error && <span className="max-w-[160px] truncate text-[10px] text-danger-500">{res.error}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
