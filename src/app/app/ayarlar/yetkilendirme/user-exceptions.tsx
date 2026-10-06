"use client";

import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
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
import { formatDateTr } from "@/lib/format";

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

/** Süre kontrolü sunucudan gelen `minExpiry` (yarın) gününe göre: dünü/bugünü geçmiş sayar (bileşende Date.now yok). */
function isActiveAt(row: OverrideRow, todayKey: string) {
  return !row.expires_at || row.expires_at.slice(0, 10) >= todayKey;
}

function fmtDate(iso: string) {
  return formatDateTr(iso, { day: "numeric", month: "long", year: "numeric" });
}

export function UserExceptions({
  members,
  selectedUserId,
  selfId,
  roleEffective,
  overrides,
  modules,
  moduleLabels,
  readOnly,
  basePath = "/app/ayarlar/yetkilendirme?sekme=izinler",
  todayKey,
  minExpiry,
  quick30Date,
}: {
  members: ExceptionMember[];
  selectedUserId: string | null;
  /** Oturum sahibi: kendine istisna yazamaz (kendini yükseltme yasağı). */
  selfId: string | null;
  /** Seçili üyenin ROL katmanlı etkin izinleri (kullanıcı istisnası HARİÇ) — soluk taban. */
  roleEffective: Partial<Record<AppModule, AppAction[]>>;
  overrides: OverrideRow[];
  modules: AppModule[];
  moduleLabels: Record<AppModule, string>;
  readOnly: boolean;
  /** Üye seçimi bu adrese `&user=` ekler (sekmeli sayfa). */
  basePath?: string;
  /** Bugünün TR gün anahtarı (YYYY-MM-DD): süresi geçen istisna soluk gösterilir (bileşende Date.now yok). */
  todayKey: string;
  /** Date input alt sınırı (yarın, YYYY-MM-DD) — sunucudan gelir. */
  minExpiry: string;
  /** "30 gün" çipinin değeri (YYYY-MM-DD) — sunucudan gelir. */
  quick30Date: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [localOverrides, setLocalOverrides] = useState<Map<string, OverrideRow>>(
    () => new Map(overrides.map((o) => [o.module, o])),
  );
  const [expiresAt, setExpiresAt] = useState<string>(""); // yyyy-mm-dd (date input)
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = members.find((m) => m.id === selectedUserId) ?? null;

  const options = useMemo(
    () =>
      members.map((m) => {
        const isOwner = m.role === "owner";
        const isSelf = m.id === selfId;
        return {
          value: m.id,
          label: m.full_name,
          hint: isOwner ? `${m.roleLabel} — istisna tanımlanamaz` : isSelf ? `${m.roleLabel} — kendinize istisna yazamazsınız` : m.roleLabel,
          disabled: isOwner || isSelf,
        };
      }),
    [members, selfId],
  );

  function selectMember(id: string) {
    setError(null);
    setLocalOverrides(new Map());
    router.push(id ? `${basePath}&user=${id}` : basePath);
  }

  /** Geçici yetki için ISO son tarih — date input günün sonuna (23:59 yerel) çevrilir. */
  function expiryIso(): string | null {
    if (!expiresAt) return null;
    const d = new Date(`${expiresAt}T23:59:59`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  function effectiveFor(mod: AppModule): { actions: string[]; override: OverrideRow | null } {
    const o = localOverrides.get(mod);
    if (o && isActiveAt(o, todayKey)) return { actions: o.actions, override: o };
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

  /** "30 gün" hızlı çipi — bugünden 30 gün sonrası (sunucu hesapladı). */
  function quick30() {
    setExpiresAt(quick30Date);
  }

  const overrideCount = Array.from(localOverrides.values()).filter((o) => isActiveAt(o, todayKey)).length;

  return (
    <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
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
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {busyKey === "all" ? "Temizleniyor…" : "Tüm istisnaları kaldır"}
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto] lg:items-end">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-text-faint">
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
              <label htmlFor="exception-expiry" className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-text-faint">
                <CalendarClock className="h-3.5 w-3.5" /> Bitiş tarihi (opsiyonel)
              </label>
              <input
                id="exception-expiry"
                type="date"
                value={expiresAt}
                min={minExpiry}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm text-ink-950 outline-none focus:border-brand-400"
              />
            </div>
            <div className="flex items-center gap-1.5 pb-0.5">
              <button
                type="button"
                onClick={quick30}
                className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
              >
                30 gün
              </button>
              {expiresAt ? (
                <button
                  type="button"
                  onClick={() => setExpiresAt("")}
                  className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
                >
                  Süresiz
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {!readOnly && expiresAt && selected ? (
        <p className="mt-2 text-xs text-amber-600">
          Geçici yetki modu: bundan sonra tıkladığınız hücreler <strong>{fmtDate(`${expiresAt}T12:00:00`)}</strong>{" "}
          gününün sonunda otomatik sona erer.
        </p>
      ) : null}

      {error ? <p className="mt-3 text-sm text-danger-500" role="alert">{error}</p> : null}

      {!selected ? (
        <p className="mt-5 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
          İstisnalarını görmek için yukarıdan bir ekip üyesi seçin.
        </p>
      ) : (
        <>
          <p className="mt-4 text-xs text-text-muted">
            <span className="font-semibold text-ink-950">{selected.full_name}</span> · rol:{" "}
            <span className="font-semibold">{selected.roleLabel}</span>
            {overrideCount > 0 ? (
              <span className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-600">
                {overrideCount} modülde istisna
              </span>
            ) : null}
          </p>

          <div className="mt-3 overflow-x-auto">
            <Table className="w-full min-w-[620px] border-collapse text-sm">
              <THead>
                <TR className="border-b border-line text-left text-xs font-bold uppercase tracking-[0.08em] text-text-faint">
                  <TH scope="col" className="py-2 pr-3">Modül</TH>
                  {ACTIONS.map((a) => (
                    <TH scope="col" key={a.value} className="px-2 py-2 text-center">{a.label}</TH>
                  ))}
                  <TH scope="col" className="px-2 py-2 text-right">İstisna</TH>
                </TR>
              </THead>
              <TBody>
                {modules.map((mod) => {
                  const { actions, override } = effectiveFor(mod);
                  const stored = localOverrides.get(mod);
                  const expired = stored && !isActiveAt(stored, todayKey);
                  return (
                    <TR key={mod} className={`border-b border-line/60 last:border-0 ${override ? "bg-amber-400/[0.04]" : ""}`}>
                      <TH scope="row" className="py-2.5 pr-3 text-left text-sm font-medium text-ink-950">
                        {moduleLabels[mod]}
                        {override?.expires_at ? (
                          <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-600">
                            <CalendarClock className="h-3 w-3" /> {fmtDate(override.expires_at)}
                          </span>
                        ) : null}
                        {expired ? (
                          <span className="ml-1.5 rounded-full bg-ink-950/8 px-2 py-0.5 text-xs font-semibold text-text-muted">
                            Süresi doldu
                          </span>
                        ) : null}
                      </TH>
                      {ACTIONS.map((a) => {
                        const key = `${mod}:${a.value}`;
                        const allowed = actions.includes(a.value);
                        const busy = busyKey === key;
                        return (
                          <TD key={key} className="px-2 py-2 text-center">
                            <button
                              type="button"
                              disabled={readOnly || busy}
                              aria-pressed={allowed}
                              aria-label={`${moduleLabels[mod]} — ${a.label}: ${allowed ? "izinli" : "izinsiz"}${override ? " (kişiye özel istisna)" : ""}`}
                              onClick={() => toggle(mod, a.value)}
                              title={
                                override
                                  ? "Kişiye özel istisna"
                                  : allowed
                                    ? "Rolünden geliyor"
                                    : undefined
                              }
                              className={`focus-ring relative grid h-7 w-7 touch:h-11 touch:w-11 place-items-center rounded-[var(--radius-control)] border transition ${
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
                          </TD>
                        );
                      })}
                      <TD className="px-2 py-2 text-right">
                        {override && !readOnly ? (
                          <button
                            type="button"
                            onClick={() => removeModule(mod)}
                            disabled={busyKey === `${mod}:row`}
                            className="focus-ring rounded-[var(--radius-control)] border border-line px-2 py-1 touch:min-h-11 text-xs font-semibold text-text-muted transition hover:border-danger-500/40 hover:text-danger-500 disabled:opacity-50"
                          >
                            Kaldır
                          </button>
                        ) : (
                          <span className="text-xs text-text-faint">{override ? "İstisna" : "—"}</span>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-text-faint">
            <span className="flex items-center gap-1.5">
              <span className="grid h-4 w-4 place-items-center rounded-[var(--radius-control)] border border-mint-500/30 bg-mint-500/8"><Check className="h-3 w-3 text-mint-600/60" /></span>
              rolünden geliyor (soluk)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="grid h-4 w-4 place-items-center rounded-[var(--radius-control)] border border-amber-400/60 bg-amber-400/15"><Check className="h-3 w-3 text-amber-600" /></span>
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
