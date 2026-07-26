"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Pause, Play, Trash2 } from "lucide-react";
import { applyAutomationTemplate, toggleAutomation, deleteAutomation } from "@/app/actions/automations";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type AutomationRow = {
  id: string;
  trigger_type: string;
  status: string;
};

// ---------------------------------------------------------------------------
// Şablon uygula butonu
// ---------------------------------------------------------------------------
export function ApplyTemplateButton({ templateKey }: { templateKey: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok?: boolean; error?: string } | null>(null);

  function apply() {
    setResult(null);
    const fd = new FormData();
    fd.set("template_key", templateKey);
    startTransition(async () => {
      const res = await applyAutomationTemplate(fd);
      setResult(res);
      if (res.ok) setTimeout(() => setResult(null), 3000);
    });
  }

  if (result?.ok) {
    return (
      <span className="inline-flex items-center gap-1 rounded-[7px] bg-mint-500/12 px-2 py-1 text-[11px] font-bold text-mint-600">
        <CheckCircle2 className="h-3 w-3" /> Eklendi
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={(e) => {
          // Buton bir <summary> içinde: preventDefault, uygularken kartın
          // önizleme aç/kapa durumunu değiştirmesin diye şart.
          e.preventDefault();
          apply();
        }}
        disabled={pending}
        className="shrink-0 rounded-[7px] border border-brand-300/40 px-2 py-1 text-[11px] font-semibold text-brand-600 transition hover:bg-brand-600/5 disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Uygula"}
      </button>
      {result?.error && (
        <span className="text-[11px] text-danger-500">{result.error}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Satır içi toggle + sil
// ---------------------------------------------------------------------------
export function AutomationRowActions({ row }: { row: AutomationRow }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const isActive = row.status === "active";

  function toggle() {
    setErr(null);
    startTransition(async () => {
      const res = await toggleAutomation(row.id, !isActive);
      if (res.error) setErr(res.error);
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      {err && <span className="text-[11px] text-danger-500">{err}</span>}
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        title={isActive ? "Pasif yap" : "Aktif yap"}
        className={`grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[7px] border transition disabled:opacity-50 ${
          isActive
            ? "border-amber-400/30 text-amber-600 hover:bg-amber-50"
            : "border-mint-500/30 text-mint-600 hover:bg-mint-50"
        }`}
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : isActive ? (
          <Pause className="h-3.5 w-3.5" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
      </button>
      <ConfirmDialog
        trigger={
          <button
            type="button"
            disabled={pending}
            aria-label="Otomasyonu sil"
            className="focus-ring press grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[7px] border border-line text-text-faint transition hover:border-danger-500/30 hover:text-danger-500 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        }
        title="Otomasyon silinsin mi?"
        description="Kural ve çalışma geçmişi kalıcı olarak silinir; bu işlem geri alınamaz."
        confirmLabel="Sil"
        onConfirm={async () => {
          setErr(null);
          const res = await deleteAutomation(row.id);
          if (res.error) setErr(res.error);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detay sayfası toggle'ı — listedeki toggleAutomation server action'ını kullanır
// ---------------------------------------------------------------------------
export function AutomationToggleButton({ id, status }: { id: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const isActive = status === "active";

  function toggle() {
    setErr(null);
    startTransition(async () => {
      const res = await toggleAutomation(id, !isActive);
      if (res.error) setErr(res.error);
      // Action yalnızca liste yolunu revalidate ediyor; detay görünümü
      // yeni durumu göstersin diye burada tazeliyoruz.
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={`focus-ring press inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-xs font-bold transition disabled:opacity-50 ${
          isActive
            ? "border border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20"
            : "border border-mint-400/40 bg-mint-500/10 text-mint-300 hover:bg-mint-500/20"
        }`}
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : isActive ? (
          <Pause className="h-3.5 w-3.5" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        {isActive ? "Pasif yap" : "Aktif yap"}
      </button>
      {err && <span className="text-[11px] text-danger-400">{err}</span>}
    </div>
  );
}
