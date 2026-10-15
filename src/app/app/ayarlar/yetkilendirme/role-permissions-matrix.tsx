"use client";

import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { useOptimistic, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Check, RotateCcw } from "lucide-react";
import { updateTenantPermission, resetRolePermissions } from "@/app/actions/permissions";
import { DEFAULT_MATRIX, type AppAction, type AppModule, type AppRole } from "@/lib/permissions";
import { MODULE_LABELS } from "@/lib/permission-module-labels";

const ACTIONS: { value: AppAction; label: string }[] = [
  { value: "view", label: "Görüntüle" },
  { value: "create", label: "Ekle" },
  { value: "edit", label: "Düzenle" },
  { value: "delete", label: "Sil" },
];


function cellKey(mod: AppModule, action: AppAction) {
  return `${mod}:${action}`;
}

type CellChange = { mod: AppModule; action: AppAction; allowed: boolean };

/** İyimser hücre değişikliği: sunucu durumunun (prop) üstüne uygulanır, geçiş bitince prop yeniden tek kaynak olur. */
function applyCell(prev: Partial<Record<AppModule, AppAction[]>>, change: CellChange) {
  const current = new Set(prev[change.mod] ?? []);
  if (change.allowed) current.add(change.action);
  else current.delete(change.action);
  return { ...prev, [change.mod]: Array.from(current) };
}

/**
 * Rol izin matrisi. Tek kaynak SUNUCU durumudur (`effective` prop'u): hücre tıklaması `useOptimistic` ile anında
 * görünür, eylem `revalidatePath` ile taze matrisi aynı yanıtta getirir ve iyimser katman kendiliğinden düşer
 * (çift tazeleme yok). Hata olursa iyimser değer geri sarılır. Rol çipi değişiminde bileşen `key={role}` ile
 * yeniden kurulur; eski rolün yerel durumu yeni role yazılamaz (SK10 / B162).
 */
export function RolePermissionsMatrix({
  role,
  modules,
  effective,
  overriddenCells,
  readOnly,
  readOnlyReason = null,
}: {
  role: AppRole;
  modules: AppModule[];
  effective: Partial<Record<AppModule, AppAction[]>>;
  overriddenCells: string[];
  readOnly: boolean;
  /** Salt görüntüleme nedeni (ör. genel müdür kendi rolünü düzenleyemez); null = varsayılan metin. */
  readOnlyReason?: string | null;
}) {
  const [, startTransition] = useTransition();
  const [optimistic, addOptimistic] = useOptimistic(effective, applyCell);
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const overriddenSet = new Set(overriddenCells);
  const defaults = DEFAULT_MATRIX[role] ?? {};

  function isAllowed(mod: AppModule, action: AppAction) {
    return (optimistic[mod] ?? []).includes(action);
  }

  function toggle(mod: AppModule, action: AppAction) {
    if (readOnly) return;
    const key = cellKey(mod, action);
    // Hedef değer SUNUCU durumundan (prop + bekleyen iyimser katman) hesaplanır; bayat yerel kopya yok.
    const next = !isAllowed(mod, action);
    setError(null);
    setBusyCell(key);
    startTransition(async () => {
      addOptimistic({ mod, action, allowed: next });
      const result = await updateTenantPermission(role, mod, action, next);
      setBusyCell(null);
      if (!result.ok) setError(result.error ?? "Güncellenemedi.");
    });
  }

  function handleReset() {
    if (readOnly) return;
    setResetting(true);
    setError(null);
    startTransition(async () => {
      const result = await resetRolePermissions(role);
      setResetting(false);
      if (!result.ok) setError(result.error ?? "Varsayılana döndürülemedi.");
    });
  }

  const hasOverrides = overriddenCells.length > 0;

  return (
    <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-ink-950">İzin matrisi</h2>
          <p className="mt-1 text-xs text-text-muted">
            {readOnly
              ? (readOnlyReason ?? "Salt görüntüleme — düzenlemek için ofis sahibi veya genel müdür olmalısınız.")
              : "Bir hücreye tıklayarak izni açıp kapatabilirsiniz. Değişiklik anında kaydedilir."}
          </p>
        </div>
        {!readOnly ? (
          <ConfirmDialog
            title="Varsayılana döndür"
            description="Bu rol için yaptığınız tüm özelleştirmeler silinir ve varsayılan izin matrisi geçerli olur."
            confirmLabel="Döndür"
            onConfirm={handleReset}
            trigger={
          <button
            type="button"
            disabled={resetting || !hasOverrides}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {resetting ? "Sıfırlanıyor…" : "Varsayılana döndür"}
          </button>
            }
          />
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-danger-500" role="alert">{error}</p> : null}

      <div className="mt-4 overflow-x-auto">
        <Table className="w-full min-w-[560px] border-collapse text-sm">
          <THead>
            <TR className="border-b border-line text-left text-xs font-bold uppercase tracking-[0.08em] text-text-faint">
              <TH scope="col" className="py-2 pr-3">Modül</TH>
              {ACTIONS.map((a) => (
                <TH scope="col" key={a.value} className="px-2 py-2 text-center">{a.label}</TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {modules.map((mod) => (
              <TR key={mod} className="border-b border-line/60 last:border-0">
                <TH scope="row" className="py-2.5 pr-3 text-left text-sm font-medium text-ink-950">{MODULE_LABELS[mod]}</TH>
                {ACTIONS.map((a) => {
                  const key = cellKey(mod, a.value);
                  const allowed = isAllowed(mod, a.value);
                  const isOverridden = overriddenSet.has(key);
                  const isDefault = (defaults[mod] ?? []).includes(a.value);
                  const busy = busyCell === key;
                  return (
                    <TD key={key} className="px-2 py-2 text-center">
                      <button
                        type="button"
                        disabled={readOnly || busy}
                        aria-pressed={allowed}
                        aria-label={`${MODULE_LABELS[mod]} — ${a.label}: ${allowed ? "izinli" : "izinsiz"}${isOverridden ? " (özelleştirilmiş)" : ""}`}
                        onClick={() => toggle(mod, a.value)}
                        title={isOverridden ? `Özelleştirilmiş (varsayılan: ${isDefault ? "izinli" : "izinsiz"})` : undefined}
                        className={`focus-ring relative grid h-7 w-7 touch:h-11 touch:w-11 place-items-center rounded-[var(--radius-control)] border transition ${
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
                    </TD>
                  );
                })}
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-text-faint">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> işaretli hücreler varsayılandan özelleştirilmiştir.
      </p>
    </section>
  );
}
