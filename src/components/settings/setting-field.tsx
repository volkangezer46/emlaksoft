"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, History, Loader2, Lock, RotateCcw, Save, Trash2 } from "lucide-react";
import {
  resetSettingAction,
  revertSettingAction,
  saveSettingAction,
  settingHistoryAction,
} from "@/app/actions/platform-settings-center";
import { FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import type { SettingHistoryEntry, SettingView } from "@/lib/settings/types";

/**
 * Ortak ayar alanı (Sistem Ayarları Merkezi + sonraki paketlerde ofis ayar merkezi).
 * Etiket, açıklama, ETKİSİ satırı, birim, min-max, varsayılan + "varsayılana dön" (onaylı), sekmeler
 * Değer · Geçmiş · Etki, geçmişte "bu sürüme dön", yüksek riskte onay + gerekçe. Gizli ayarlarda değer ASLA gösterilmez.
 * Önizleme: gerçek sayı hesaplanamıyorsa YOK (sahte sayı yasak); etki sekmesi yalnız metin ve bağlantı verir.
 */

type Tab = "value" | "history" | "impact";
const MIN_REASON = 5;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}

function histValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  return typeof v === "string" ? (v === "" ? "(boş)" : v) : JSON.stringify(v);
}

/** Ayar eylemleri: varsayılan platform merkezi; ofis merkezi kendi (ofis kapılı) eylemlerini verir. */
type ActionResult = { ok?: boolean; error?: string; degraded?: boolean };
export type SettingFieldActions = {
  save: (key: string, value: string, reason: string) => Promise<ActionResult>;
  reset: (key: string, reason: string) => Promise<ActionResult>;
  revert: (key: string, version: number, reason: string) => Promise<ActionResult>;
  history: (key: string) => Promise<{ entries: SettingHistoryEntry[]; error?: string }>;
};

const PLATFORM_ACTIONS: SettingFieldActions = {
  save: saveSettingAction,
  reset: resetSettingAction,
  revert: revertSettingAction,
  history: settingHistoryAction,
};

export function SettingField({
  view,
  canEdit,
  actions = PLATFORM_ACTIONS,
  readOnlyNote = "Bu ayar yalnız süper admin tarafından değiştirilir.",
}: {
  view: SettingView;
  canEdit: boolean;
  actions?: SettingFieldActions;
  readOnlyNote?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<Tab>("value");
  const initial = view.type === "bool" ? (view.formValue === "on" || view.formValue === "true" ? "true" : "false") : view.formValue;
  const [value, setValue] = useState(initial);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState<null | "save" | "reset" | "clear">(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [history, setHistory] = useState<SettingHistoryEntry[] | null>(null);
  const [histError, setHistError] = useState<string | null>(null);

  const secret = view.sensitivity === "secret";
  const editable = canEdit && view.editMode === "center";
  const dirty = secret ? value.trim().length > 0 : value !== initial;
  const high = view.risk === "high";
  const reasonOk = !high || reason.trim().length >= MIN_REASON;

  function run(fn: () => Promise<{ ok?: boolean; error?: string; degraded?: boolean }>, okText: string) {
    setNotice(null);
    start(async () => {
      const res = await fn();
      if (res.error) setNotice({ tone: "error", text: res.error });
      else {
        setNotice({
          tone: "ok",
          text: res.degraded ? `${okText} (geçmiş kaydı için veritabanı güncellemesi bekleniyor)` : okText,
        });
        setConfirm(null);
        setReason("");
        setHistory(null);
        if (secret) setValue("");
        router.refresh();
      }
    });
  }

  function save() {
    if (!dirty) return;
    if (high && confirm !== "save") {
      setConfirm("save");
      return;
    }
    if (!reasonOk) return;
    run(() => actions.save(view.key, value, reason), "Kaydedildi.");
  }

  function loadHistory() {
    setTab("history");
    if (history) return;
    start(async () => {
      const res = await actions.history(view.key);
      setHistError(res.error ?? null);
      setHistory(res.entries);
    });
  }

  const input = (() => {
    if (view.editMode === "locked") return null;
    const id = `setting-${view.key}`;
    if (secret) {
      return (
        <FormInput
          id={id}
          type="password"
          autoComplete="new-password"
          placeholder={view.configured ? "Yeni değer girerek değiştirin" : "Değer girin"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={!editable || pending}
        />
      );
    }
    if (view.type === "bool") {
      return (
        <label className="inline-flex items-center gap-2 text-sm font-medium text-ink-950">
          <input
            id={id}
            type="checkbox"
            className="h-4 w-4"
            checked={value === "true"}
            onChange={(e) => setValue(e.target.checked ? "true" : "false")}
            disabled={!editable || pending}
          />
          {value === "true" ? "Açık" : "Kapalı"}
        </label>
      );
    }
    if (view.type === "enum") {
      return (
        <FormSelect id={id} value={value} onChange={(e) => setValue(e.target.value)} disabled={!editable || pending}>
          {(view.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </FormSelect>
      );
    }
    if (view.multiline) {
      return <FormTextarea id={id} rows={3} maxLength={view.max} value={value} onChange={(e) => setValue(e.target.value)} disabled={!editable || pending} />;
    }
    return (
      <FormInput
        id={id}
        type={view.type === "int" || view.type === "number" ? "number" : "text"}
        inputMode={view.type === "int" ? "numeric" : view.type === "number" ? "decimal" : undefined}
        step={view.type === "number" ? "any" : undefined}
        min={view.type === "int" || view.type === "number" ? view.min : undefined}
        max={view.type === "int" || view.type === "number" ? view.max : undefined}
        maxLength={view.type === "string" ? view.max : undefined}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={!editable || pending}
        className="max-w-xs"
      />
    );
  })();

  const tabBtn = (t: Tab, label: string, onClick?: () => void) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === t}
      onClick={onClick ?? (() => setTab(t))}
      className={`focus-ring rounded-[var(--radius-control)] px-2.5 py-1 text-xs font-semibold transition ${tab === t ? "bg-ink-950 text-white" : "text-text-muted hover:bg-canvas"}`}
    >
      {label}
    </button>
  );

  return (
    <section id={view.key} className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-labelledby={`${view.key}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`${view.key}-title`} className="text-sm font-semibold text-ink-950">
            {view.label}
            {high ? <span className="ml-2 rounded-full bg-danger-500/10 px-2 py-0.5 text-xs font-bold text-danger-600">Yüksek risk</span> : null}
            {secret ? <span className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-800">Gizli</span> : null}
          </h3>
          <p className="mt-0.5 text-xs text-text-muted">{view.description}</p>
        </div>
        <div role="tablist" aria-label={`${view.label} sekmeleri`} className="flex gap-1">
          {tabBtn("value", "Değer")}
          {tabBtn("history", "Geçmiş", loadHistory)}
          {tabBtn("impact", "Etki")}
        </div>
      </div>

      {tab === "value" ? (
        <div className="mt-3 space-y-3">
          {view.editMode === "locked" ? (
            <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-canvas px-3 py-2 text-xs text-text-muted">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {view.lockedReason} <span className="font-semibold text-ink-950">Şu an: {view.display}</span>
            </p>
          ) : view.editMode === "bridge" ? (
            <p className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
              <span className="font-semibold text-ink-950">{view.display}</span> · Bu ayar kendi ekranında düzenlenir (çift düzenleme yok).
              {view.editHref ? (
                <Link href={view.editHref} className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline">
                  Ekranı aç <ArrowUpRight className="h-3 w-3" />
                </Link>
              ) : null}
            </p>
          ) : (
            <>
              {secret ? (
                <p className="text-xs text-text-muted">
                  Durum: <span className="font-semibold text-ink-950">{view.display}</span>
                  {view.plaintext ? " · eski düz metin (şifrelenmeli)" : view.configured ? " · şifreli" : ""}
                  {view.envFallback && !view.configured ? ` · yedek: ortam değişkeni ${view.envFallback}` : ""}
                </p>
              ) : null}
              {input}
              {view.type !== "bool" && view.type !== "enum" && !secret && (view.min != null || view.unit) ? (
                <p className="text-xs text-text-faint">
                  {view.min != null && view.max != null && view.type !== "string" ? `${view.min} – ${view.max}` : null}
                  {view.unit ? ` ${view.unit}` : null}
                </p>
              ) : null}
              {!secret ? <p className="text-xs text-text-faint">Varsayılan: {view.defaultDisplay}</p> : null}

              {confirm ? (
                <div className="space-y-2 rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-900">
                  <p className="font-semibold">
                    {confirm === "save" ? "Bu yüksek riskli ayar değiştirilecek." : confirm === "clear" ? "Gizli değer silinecek." : "Ayar varsayılana dönecek."} Gerekçe yazın (en az {MIN_REASON} karakter).
                  </p>
                  <FormInput aria-label="Gerekçe" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Neden değiştiriyorsunuz?" maxLength={500} />
                  <span className="inline-flex gap-2">
                    <button
                      type="button"
                      disabled={pending || reason.trim().length < MIN_REASON}
                      onClick={() => {
                        if (confirm === "save") run(() => actions.save(view.key, value, reason), "Kaydedildi.");
                        else run(() => actions.reset(view.key, reason), confirm === "clear" ? "Silindi." : "Varsayılana dönüldü.");
                      }}
                      className="focus-ring press rounded-[var(--radius-control)] bg-ink-950 px-3 py-1.5 text-white disabled:opacity-60"
                    >
                      Onayla
                    </button>
                    <button type="button" onClick={() => setConfirm(null)} className="focus-ring press rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-ink-950">
                      Vazgeç
                    </button>
                  </span>
                </div>
              ) : null}

              {editable && !confirm ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={save}
                    disabled={pending || !dirty}
                    className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-ink-950 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {secret ? "Değiştir" : "Kaydet"}
                  </button>
                  {secret && view.configured ? (
                    <button
                      type="button"
                      onClick={() => setConfirm("clear")}
                      disabled={pending}
                      className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-danger-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Sil
                    </button>
                  ) : null}
                  {!secret && !view.isDefault ? (
                    <button
                      type="button"
                      onClick={() => setConfirm("reset")}
                      disabled={pending}
                      className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-950"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Varsayılana dön
                    </button>
                  ) : null}
                </div>
              ) : null}
              {!canEdit ? <p className="text-xs text-text-faint">{readOnlyNote}</p> : null}
            </>
          )}
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="mt-3 space-y-2" aria-live="polite">
          {pending && !history ? <p className="text-xs text-text-muted">Geçmiş yükleniyor…</p> : null}
          {histError ? <p className="text-xs text-danger-600">{histError}</p> : null}
          {history && history.length === 0 ? (
            <p className="flex items-center gap-2 text-xs text-text-muted">
              <History className="h-3.5 w-3.5" /> Henüz kayıtlı değişiklik yok (varsayılan veya geçmiş tablosu henüz uygulanmadı).
            </p>
          ) : null}
          {history?.map((h) => (
            <div key={h.id} className="rounded-[var(--radius-control)] border border-line px-3 py-2 text-xs">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-ink-950">v{h.version}</span>
                <span className="text-text-muted">{fmtDate(h.createdAt)}</span>
                <span className="text-text-faint">{h.actorType === "direct" ? "doğrudan yazım" : h.actorType}</span>
                {h.summary ? <span className="text-text-faint">{h.summary}</span> : null}
              </p>
              {h.isSecret ? (
                <p className="mt-1 text-text-muted">Gizli değer (kaydedilmez){h.fingerprint ? ` · parmak izi ${h.fingerprint}` : ""}</p>
              ) : (
                <p className="mt-1 text-text-muted">
                  {histValue(h.oldValue)} → <span className="font-semibold text-ink-950">{histValue(h.newValue)}</span>
                </p>
              )}
              {h.reason ? <p className="mt-0.5 text-text-faint">Gerekçe: {h.reason}</p> : null}
              {editable && !h.isSecret && h.actorType !== "direct" ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    const why = `v${h.version} sürümüne dönüldü`;
                    run(() => actions.revert(view.key, h.version, why), why + ".");
                  }}
                  className="focus-ring press mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
                >
                  <RotateCcw className="h-3 w-3" /> Bu sürüme dön
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {tab === "impact" ? (
        <div className="mt-3 space-y-2 text-xs text-text-muted">
          <p>
            <span className="font-semibold text-ink-950">ETKİSİ:</span> {view.impact}
          </p>
          <p className="text-text-faint">Bu ayar için canlı etki önizlemesi yok: gerçek bir sayı hesaplanamadığı için gösterilmiyor.</p>
          {view.envFallback ? <p>Yedek kaynak: ortam değişkeni <code>{view.envFallback}</code>.</p> : null}
        </div>
      ) : null}

      <p className="mt-2 text-xs" role={notice?.tone === "error" ? "alert" : "status"}>
        {notice ? <span className={notice.tone === "error" ? "font-medium text-danger-600" : "font-medium text-mint-700"}>{notice.text}</span> : null}
      </p>
    </section>
  );
}