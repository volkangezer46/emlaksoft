"use client";

import { useState, useTransition, useCallback } from "react";
import { CheckSquare, Square, ChevronDown, Loader2, X } from "lucide-react";
import { bulkUpdatePropertyStatus } from "@/app/actions/bulk-property";

const STATUS_OPTIONS = [
  { value: "live",      label: "Yayında" },
  { value: "draft",     label: "Taslak" },
  { value: "reserved",  label: "Rezerve" },
  { value: "passive",   label: "Pasif" },
  { value: "sold",      label: "Satıldı" },
  { value: "rented",    label: "Kiralandı" },
  { value: "withdrawn", label: "Vazgeçildi" },
  { value: "archived",  label: "Arşiv" },
];

type PropertyItem = {
  id:           string;
  property_code: string;
  title:        string | null;
  status:       string;
};

export function PropertyBulkActions({
  properties,
}: {
  properties: PropertyItem[];
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [result, setResult] = useState<{ ok?: boolean; error?: string; updatedCount?: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const allSelected = properties.length > 0 && selectedIds.size === properties.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(properties.map((p) => p.id)));
    }
  }, [allSelected, properties]);

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBulkStatus = (status: string) => {
    setDropdownOpen(false);
    if (!selectedIds.size) return;
    setResult(null);
    startTransition(async () => {
      const res = await bulkUpdatePropertyStatus([...selectedIds], status);
      setResult(res);
      if (res.ok) setSelectedIds(new Set());
    });
  };

  return (
    <div className="space-y-3">
      {/* Toplu aksiyon araç çubuğu — seçim varken göster */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-[14px] border border-brand-300/40 bg-brand-600/[0.04] px-4 py-2.5">
          <span className="text-sm font-semibold text-brand-700">
            {selectedIds.size} portföy seçildi
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setDropdownOpen((s) => !s)}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-[9px] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Durum değiştir
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {dropdownOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-[12px] border border-line bg-surface shadow-[var(--shadow-lg)]">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => handleBulkStatus(s.value)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-ink-950 transition hover:bg-canvas"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[7px] text-text-muted hover:bg-line"
            aria-label="Seçimi temizle"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Sonuç mesajı */}
      {result?.ok && (
        <div className="rounded-[10px] bg-mint-500/10 px-4 py-2 text-sm font-semibold text-mint-700">
          ✓ {result.updatedCount} portföy güncellendi.
        </div>
      )}
      {result?.error && (
        <div className="rounded-[10px] bg-red-50 px-4 py-2 text-sm text-red-600">
          {result.error}
        </div>
      )}

      {/* Tablo başlığı — tümünü seç */}
      <div className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <button
            type="button"
            onClick={toggleAll}
            aria-label={allSelected ? "Tüm seçimi kaldır" : "Tümünü seç"}
            className="text-brand-600"
          >
            {allSelected ? (
              <CheckSquare className="h-4 w-4" />
            ) : someSelected ? (
              <CheckSquare className="h-4 w-4 opacity-50" />
            ) : (
              <Square className="h-4 w-4 text-text-faint" />
            )}
          </button>
          <span className="text-xs text-text-muted">
            {properties.length} portföy
            {selectedIds.size > 0 && ` · ${selectedIds.size} seçili`}
          </span>
        </div>

        {/* Portföy satırları */}
        <div className="divide-y divide-line">
          {properties.map((p) => {
            const checked = selectedIds.has(p.id);
            return (
              <label
                key={p.id}
                className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-canvas/60 ${checked ? "bg-brand-600/[0.03]" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleOne(p.id)}
                  className="sr-only"
                />
                <span className="shrink-0 text-brand-600">
                  {checked ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-text-faint" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="truncate text-sm font-semibold text-ink-950">
                    {p.title ?? p.property_code}
                  </span>
                  <span className="ml-2 text-xs text-text-faint">{p.property_code}</span>
                </span>
                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                  {p.status}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
