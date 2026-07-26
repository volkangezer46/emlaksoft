"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, RotateCcw } from "lucide-react";
import { updateTenantPermission, resetRolePermissions } from "@/app/actions/permissions";
import { DEFAULT_MATRIX, type AppAction, type AppModule, type AppRole } from "@/lib/permissions";

const ACTIONS: { value: AppAction; label: string }[] = [
  { value: "view", label: "Görüntüle" },
  { value: "create", label: "Ekle" },
  { value: "edit", label: "Düzenle" },
  { value: "delete", label: "Sil" },
];

export const MODULE_LABELS: Record<AppModule, string> = {
  dashboard:   "Ana ekran",
  customers:   "Müşteriler",
  demands:     "Talepler",
  properties:  "Portföyler",
  matching:    "Eşleştirme",
  portals:     "Portal kontrol",
  leak:        "Kayıp-kaçak",
  appointments:"Randevular",
  calls:       "Akıllı arama",
  commissions: "Komisyon / Anlaşmalar",
  tasks:       "Görevler",
  team:        "Ekip",
  support:     "Destek",
  settings:    "Ayarlar",
  billing:     "Abonelik",
  reports:     "Raporlar",
  valuation:   "Değerleme",
  compliance:  "Uyum",
  campaigns:   "Kampanyalar",
  contracts:   "Sözleşmeler",
  expenses:    "Giderler",
  offers:      "Teklifler",
  targets:     "Hedefler",
  open_house:  "Açık Ev",
  rentals:     "Kiralama Yönetimi",
  projects:    "Proje Satış",
  network:     "Ofisler Arası Ağ",
};

function cellKey(mod: AppModule, action: AppAction) {
  return `${mod}:${action}`;
}

export function RolePermissionsMatrix({
  role,
  modules,
  effective,
  overriddenCells,
  readOnly,
}: {
  role: AppRole;
  modules: AppModule[];
  effective: Partial<Record<AppModule, AppAction[]>>;
  overriddenCells: string[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [localEffective, setLocalEffective] = useState(effective);
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const overriddenSet = new Set(overriddenCells);
  const defaults = DEFAULT_MATRIX[role] ?? {};

  function isAllowed(mod: AppModule, action: AppAction) {
    return (localEffective[mod] ?? []).includes(action);
  }

  function toggle(mod: AppModule, action: AppAction) {
    if (readOnly) return;
    const key = cellKey(mod, action);
    const next = !isAllowed(mod, action);
    setError(null);
    setBusyCell(key);
    setLocalEffective((prev) => {
      const current = new Set(prev[mod] ?? []);
      if (next) current.add(action);
      else current.delete(action);
      return { ...prev, [mod]: Array.from(current) };
    });
    startTransition(async () => {
      const result = await updateTenantPermission(role, mod, action, next);
      setBusyCell(null);
      if (!result.ok) {
        setError(result.error ?? "Güncellenemedi.");
        setLocalEffective(effective);
      } else {
        router.refresh();
      }
    });
  }

  function handleReset() {
    if (readOnly) return;
    setResetting(true);
    setError(null);
    startTransition(async () => {
      const result = await resetRolePermissions(role);
      setResetting(false);
      if (!result.ok) {
        setError(result.error ?? "Varsayılana döndürülemedi.");
      } else {
        setLocalEffective(defaults);
        router.refresh();
      }
    });
  }

  const hasOverrides = overriddenCells.length > 0;

  return (
    <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-ink-950">İzin matrisi</h2>
          <p className="mt-1 text-xs text-text-muted">
            {readOnly
              ? "Salt görüntüleme — düzenlemek için ofis sahibi veya genel müdür olmalısınız."
              : "Bir hücreye tıklayarak izni açıp kapatabilirsiniz. Değişiklik anında kaydedilir."}
          </p>
        </div>
        {!readOnly ? (
          <button
            type="button"
            onClick={handleReset}
            disabled={resetting || !hasOverrides}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-line px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {resetting ? "Sıfırlanıyor…" : "Varsayılana döndür"}
          </button>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-danger-500" role="alert">{error}</p> : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">
              <th className="py-2 pr-3">Modül</th>
              {ACTIONS.map((a) => (
                <th key={a.value} className="px-2 py-2 text-center">{a.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((mod) => (
              <tr key={mod} className="border-b border-line/60 last:border-0">
                <td className="py-2.5 pr-3 text-sm font-medium text-ink-950">{MODULE_LABELS[mod]}</td>
                {ACTIONS.map((a) => {
                  const key = cellKey(mod, a.value);
                  const allowed = isAllowed(mod, a.value);
                  const isOverridden = overriddenSet.has(key);
                  const isDefault = (defaults[mod] ?? []).includes(a.value);
                  const busy = busyCell === key;
                  return (
                    <td key={key} className="px-2 py-2 text-center">
                      <button
                        type="button"
                        disabled={readOnly || busy}
                        onClick={() => toggle(mod, a.value)}
                        title={isOverridden ? `Özelleştirilmiş (varsayılan: ${isDefault ? "izinli" : "izinsiz"})` : undefined}
                        className={`relative grid h-7 w-7 place-items-center rounded-[8px] border transition ${
                          allowed
                            ? "border-mint-500/40 bg-mint-500/12 text-mint-600"
                            : "border-line bg-canvas text-transparent"
                        } ${readOnly ? "cursor-default opacity-70" : "cursor-pointer hover:border-brand-300"} ${busy ? "opacity-50" : ""}`}
                      >
                        {allowed ? <Check className="h-4 w-4" /> : null}
                        {isOverridden ? (
                          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
                        ) : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-text-faint">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> işaretli hücreler varsayılandan özelleştirilmiştir.
      </p>
    </section>
  );
}
