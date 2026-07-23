"use client";

import { useTransition, useState } from "react";
import { Eye, EyeOff, RadioTower, Save, Trash2 } from "lucide-react";
import { savePortalApiKey, clearPortalApiKey, type PortalKeyResult } from "@/app/actions/portal-keys";

// ---------------------------------------------------------------------------
// PortalKeyCard — tek portal için kart
// ---------------------------------------------------------------------------

function PortalKeyCard({
  portal,
  label,
  configured,
  maskedKey,
  canEdit,
}: {
  portal: string;
  label: string;
  configured: boolean;
  maskedKey: string | null;
  canEdit: boolean;
}) {
  const [show, setShow] = useState(false);
  const [result, setResult] = useState<PortalKeyResult | null>(null);
  const [saving, startSave] = useTransition();
  const [clearing, startClear] = useTransition();

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSave(async () => {
      const res = await savePortalApiKey(portal, fd);
      setResult(res);
    });
  }

  function handleClear() {
    if (!confirm(`${label} API anahtarı silinsin mi?`)) return;
    startClear(async () => {
      const res = await clearPortalApiKey(portal);
      setResult(res);
    });
  }

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
          <RadioTower className="h-4 w-4" /> {label}
        </p>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
          configured ? "bg-mint-500/12 text-mint-600" : "bg-zinc-100 text-zinc-500"
        }`}>
          {configured ? "Bağlı" : "Tanımsız"}
        </span>
      </div>

      {configured && maskedKey && (
        <div className="mt-3 flex items-center gap-2 rounded-[10px] border border-line bg-canvas/60 px-3 py-2">
          <code className="flex-1 text-xs text-text-muted">{show ? maskedKey : maskedKey}</code>
          <button type="button" onClick={() => setShow((s) => !s)} className="text-text-faint hover:text-ink-950" aria-label="Göster/gizle">
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}

      {canEdit && (
        <form onSubmit={handleSave} className="mt-4 space-y-2.5">
          <input
            name="api_key"
            type="password"
            autoComplete="off"
            placeholder="API anahtarı"
            className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm text-ink-950 outline-none focus:border-brand-300"
          />
          <input
            name="agency_id"
            type="text"
            autoComplete="off"
            placeholder="Acente ID (opsiyonel)"
            className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm text-ink-950 outline-none focus:border-brand-300"
          />
          <input
            name="base_url"
            type="url"
            autoComplete="off"
            placeholder="API base URL (opsiyonel)"
            className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm text-ink-950 outline-none focus:border-brand-300"
          />
          {result?.error && (
            <p className="rounded-[8px] bg-red-50 px-3 py-1.5 text-xs text-red-600">{result.error}</p>
          )}
          {result?.ok && (
            <p className="rounded-[8px] bg-mint-500/10 px-3 py-1.5 text-xs text-mint-700">Kaydedildi ✓</p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" /> {saving ? "Kaydediliyor…" : "Kaydet"}
            </button>
            {configured && (
              <button
                type="button"
                onClick={handleClear}
                disabled={clearing}
                className="inline-flex items-center gap-1 rounded-[10px] border border-line px-3 py-2 text-xs font-semibold text-danger-500 transition hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Sil
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ana export: tüm portal kartları
// ---------------------------------------------------------------------------

export function PortalApiKeysSection({
  canEdit,
  sahibindenConfigured,
  hepsiemlakConfigured,
  zingatConfigured,
  maskedSahibinden,
  maskedHepsiemlak,
  maskedZingat,
}: {
  canEdit: boolean;
  sahibindenConfigured: boolean;
  hepsiemlakConfigured: boolean;
  zingatConfigured: boolean;
  maskedSahibinden: string | null;
  maskedHepsiemlak: string | null;
  maskedZingat: string | null;
}) {
  return (
    <div>
      <p className="mb-3 flex items-center gap-2 text-xs font-semibold text-text-muted">
        <RadioTower className="h-3.5 w-3.5" /> Portal API entegrasyonları (ilan otomatik gönderim)
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <PortalKeyCard
          portal="sahibinden"
          label="Sahibinden.com"
          configured={sahibindenConfigured}
          maskedKey={maskedSahibinden}
          canEdit={canEdit}
        />
        <PortalKeyCard
          portal="hepsiemlak"
          label="Hepsiemlak"
          configured={hepsiemlakConfigured}
          maskedKey={maskedHepsiemlak}
          canEdit={canEdit}
        />
        <PortalKeyCard
          portal="zingat"
          label="Zingat"
          configured={zingatConfigured}
          maskedKey={maskedZingat}
          canEdit={canEdit}
        />
      </div>
    </div>
  );
}
