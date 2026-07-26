"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, RotateCcw, UserRound } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import {
  clearUserPermissionOverrides,
  removeUserPermissionOverride,
  setUserPermissionOverride,
} from "@/app/actions/permissions";
import type { AppAction, AppModule } from "@/lib/permissions";

const ACTIONS: { value: AppAction; label: string }[] = [
  { value: "view", label: "Görüntüle" },
  { value: "create", label: "Ekle" },
  { value: "edit", label: "Düzenle" },
  { value: "delete", label: "Sil" },
];

export type ExceptionMember = { id: string; full_name: string; role: string; roleLabel: string };
export type OverrideRow = { module: string; actions: string[]; expires_at: string | null };

function sameSet(a: Iterable<string>, b: Iterable<string>) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

function isActive(row: OverrideRow) {
  return !row.expires_at || new Date(row.expires_at).getTime() > Date.now();
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
}

export function UserExceptions({
  members,
  selectedUserId,
  roleEffective,
  overrides,
  modules,
  moduleLabels,
  readOnly,
}: {
  members: ExceptionMember[];
  selectedUserId: string | null;
  /** Seçili üyenin ROL katmanlı etkin izinleri (kullanıcı istisnası HARİÇ) — soluk taban. */
  roleEffective: Partial<Record<AppModule, AppAction[]>>;
  overrides: OverrideRow[];
  modules: AppModule[];
  moduleLabels: Record<AppModule, string>;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [localOverrides, setLocalOverrides] = useState<Map<string, OverrideRow>>(
    () => new Map(overrides.map((o) => [o.module, o])),
  );
  const [expiresAt, setExpiresAt] = useState<string>(""); // yyyy-mm-dd (date input)
  // Date input alt sınırı (yarın) — render saflığı için tek sefer hesaplanır.
  const [minExpiry] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = members.find((m) => m.id === selectedUserId) ?? null;

  const options = useMemo(
    () =>
      members.map((m) => ({
        value: m.id,
        label: m.full_name,
        hint: m.role === "owner" ? `${m.roleLabel} — istisna tanımlanamaz` : m.roleLabel,
        disabled: m.role === "owner",
      })),
    [members],
  );

  function selectMember(id: string) {
    setError(null);
    setLocalOverrides(new Map());
    router.push(id ? `/app/ayarlar/roller?tab=istisnalar&user=${id}` : "/app/ayarlar/roller?tab=istisnalar");
  }

  /** Geçici yetki için ISO son tarih — date input günün sonuna (23:59 yerel) çevrilir. */
  function expiryIso(): string | null {
    if (!expiresAt) return null;
    const d = new Date(`${expiresAt}T23:59:59`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  function effectiveFor(mod: AppModule): { actions: string[]; override: OverrideRow | null } {
    const o = localOverrides.get(mod);
    if (o && isActive(o)) return { actions: o.actions, override: o };
    return { actions: roleEffective[mod] ?? [], override: null };
  }

  function toggle(mod: AppModule, action: AppAction) {
    if (readOnly || !selected) return;
    const key = `${mod}:${action}`;
    const { actions } = effectiveFor(mod);
    const next = new Set(actions);
    if (next.has(action)) next.delete(action);
    else next.add(action);

    const roleSet = roleEffective[mod] ?? [];
    const backToRole = sameSet(next, roleSet);
    const iso = expiryIso();

    setError(null);
    setBusyKey(key);
    // İyimser güncelleme — hata olursa router.refresh sunucu gerçeğine döndürür.
    setLocalOverrides((prev) => {
      const map = new Map(prev);
      if (backToRole) map.delete(mod);
      else map.set(mod, { module: mod, actions: Array.from(next), expires_at: iso });
      return map;
    });

    startTransition(async () => {
      const result = backToRole
        ? await removeUserPermissionOverride(selected.id, mod)
        : await setUserPermissionOverride(selected.id, mod, Array.from(next) as AppAction[], iso);
      setBusyKey(null);
      if (!result.ok) {
        setError(result.error ?? "Kaydedilemedi.");
        // İyimser güncellemeyi geri al — son sunucu görüntüsüne dön.
        setLocalOverrides(new Map(overrides.map((o) => [o.module, o])));
      }
      router.refresh();
    });
  }

  function removeModule(mod: AppModule) {
    if (readOnly || !selected) return;
    setError(null);
    setBusyKey(`${mod}:row`);
    setLocalOverrides((prev) => {
      const map = new Map(prev);
      map.delete(mod);
      return map;
    });
    startTransition(async () => {
      const result = await removeUserPermissionOverride(selected.id, mod);
      setBusyKey(null);
      if (!result.ok) setError(result.error ?? "Kaldırılamadı.");
      router.refresh();
    });
  }

  function clearAll() {
    if (readOnly || !selected) return;
    setError(null);
    setBusyKey("all");
    setLocalOverrides(new Map());
    startTransition(async () => {
      const result = await clearUserPermissionOverrides(selected.id);
      setBusyKey(null);
      if (!result.ok) setError(result.error ?? "Temizlenemedi.");
      router.refresh();
    });
  }

  /** "30 gün" hızlı çipi — bugünden 30 gün sonrası, date input formatında. */
  function quick30() {
    const d = new Date(Date.now() + 30 * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    setExpiresAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }

  const overrideCount = Array.from(localOverrides.values()).filter(isActive).length;

  return (
    <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <UserRound className="h-4 w-4 text-brand-600" /> Kullanıcı istisnaları
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            {readOnly
              ? "Salt görüntüleme — düzenlemek için ofis sahibi veya genel müdür olmalısınız."
              : "Bir üye seçin; hücreye tıklayınca o modül için kişiye özel istisna yazılır. Rolünden gelen izinler soluk, istisnalar vurgulu gösterilir."}
          </p>
        </div>
        {selected && !readOnly && overrideCount > 0 ? (
          <button
            type="button"
            onClick={clearAll}
            disabled={busyKey === "all"}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-line px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {busyKey === "all" ? "Temizleniyor…" : "Tüm istisnaları kaldır"}
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto] lg:items-end">
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint">
            Ekip üyesi
          </label>
          <Combobox
            options={options}
            value={selectedUserId ?? ""}
            onValueChange={selectMember}
            placeholder="Üye seçin…"
            searchPlaceholder="İsimle ara…"
            emptyText="Üye bulunamadı"
            aria-label="İstisna tanımlanacak üye"
          />
        </div>
        {!readOnly ? (
          <>
            <div>
              <label htmlFor="exception-expiry" className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint">
                <CalendarClock className="h-3.5 w-3.5" /> Bitiş tarihi (opsiyonel)
              </label>
              <input
                id="exception-expiry"
                type="date"
                value={expiresAt}
                min={minExpiry}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm text-ink-950 outline-none focus:border-brand-400"
              />
            </div>
            <div className="flex items-center gap-1.5 pb-0.5">
              <button
                type="button"
                onClick={quick30}
                className="rounded-full border border-line px-3 py-1.5 text-[11px] font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
              >
                30 gün
              </button>
              {expiresAt ? (
                <button
                  type="button"
                  onClick={() => setExpiresAt("")}
                  className="rounded-full border border-line px-3 py-1.5 text-[11px] font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
                >
                  Süresiz
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {!readOnly && expiresAt && selected ? (
        <p className="mt-2 text-[11px] text-amber-600">
          Geçici yetki modu: bundan sonra tıkladığınız hücreler <strong>{fmtDate(`${expiresAt}T12:00:00`)}</strong>{" "}
          gününün sonunda otomatik sona erer.
        </p>
      ) : null}

      {error ? <p className="mt-3 text-sm text-danger-500" role="alert">{error}</p> : null}

      {!selected ? (
        <p className="mt-5 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
          İstisnalarını görmek için yukarıdan bir ekip üyesi seçin.
        </p>
      ) : (
        <>
          <p className="mt-4 text-xs text-text-muted">
            <span className="font-semibold text-ink-950">{selected.full_name}</span> · rol:{" "}
            <span className="font-semibold">{selected.roleLabel}</span>
            {overrideCount > 0 ? (
              <span className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-bold text-amber-600">
                {overrideCount} modülde istisna
              </span>
            ) : null}
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">
                  <th className="py-2 pr-3">Modül</th>
                  {ACTIONS.map((a) => (
                    <th key={a.value} className="px-2 py-2 text-center">{a.label}</th>
                  ))}
                  <th className="px-2 py-2 text-right">İstisna</th>
                </tr>
              </thead>
              <tbody>
                {modules.map((mod) => {
                  const { actions, override } = effectiveFor(mod);
                  const stored = localOverrides.get(mod);
                  const expired = stored && !isActive(stored);
                  return (
                    <tr key={mod} className={`border-b border-line/60 last:border-0 ${override ? "bg-amber-400/[0.04]" : ""}`}>
                      <td className="py-2.5 pr-3 text-sm font-medium text-ink-950">
                        {moduleLabels[mod]}
                        {override?.expires_at ? (
                          <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                            <CalendarClock className="h-3 w-3" /> {fmtDate(override.expires_at)}
                          </span>
                        ) : null}
                        {expired ? (
                          <span className="ml-1.5 rounded-full bg-ink-950/8 px-2 py-0.5 text-[10px] font-semibold text-text-muted">
                            Süresi doldu
                          </span>
                        ) : null}
                      </td>
                      {ACTIONS.map((a) => {
                        const key = `${mod}:${a.value}`;
                        const allowed = actions.includes(a.value);
                        const busy = busyKey === key;
                        return (
                          <td key={key} className="px-2 py-2 text-center">
                            <button
                              type="button"
                              disabled={readOnly || busy}
                              onClick={() => toggle(mod, a.value)}
                              title={
                                override
                                  ? "Kişiye özel istisna"
                                  : allowed
                                    ? "Rolünden geliyor"
                                    : undefined
                              }
                              className={`relative grid h-7 w-7 place-items-center rounded-[8px] border transition ${
                                allowed
                                  ? override
                                    ? "border-amber-400/60 bg-amber-400/15 text-amber-600"
                                    : "border-mint-500/30 bg-mint-500/8 text-mint-600/60"
                                  : override
                                    ? "border-amber-400/40 bg-canvas text-transparent"
                                    : "border-line bg-canvas text-transparent"
                              } ${readOnly ? "cursor-default opacity-70" : "cursor-pointer hover:border-brand-300"} ${busy ? "opacity-50" : ""}`}
                            >
                              {allowed ? <Check className="h-4 w-4" /> : null}
                              {override ? (
                                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
                              ) : null}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-right">
                        {override && !readOnly ? (
                          <button
                            type="button"
                            onClick={() => removeModule(mod)}
                            disabled={busyKey === `${mod}:row`}
                            className="rounded-[8px] border border-line px-2 py-1 text-[11px] font-semibold text-text-muted transition hover:border-danger-500/40 hover:text-danger-500 disabled:opacity-50"
                          >
                            Kaldır
                          </button>
                        ) : (
                          <span className="text-[11px] text-text-faint">{override ? "İstisna" : "—"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-text-faint">
            <span className="flex items-center gap-1.5">
              <span className="grid h-4 w-4 place-items-center rounded-[5px] border border-mint-500/30 bg-mint-500/8"><Check className="h-3 w-3 text-mint-600/60" /></span>
              rolünden geliyor (soluk)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="grid h-4 w-4 place-items-center rounded-[5px] border border-amber-400/60 bg-amber-400/15"><Check className="h-3 w-3 text-amber-600" /></span>
              kişiye özel istisna
            </span>
            <span className="flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" /> tarihli rozet: geçici yetki, süre sonunda rol iznine döner
            </span>
          </div>
        </>
      )}
    </section>
  );
}
