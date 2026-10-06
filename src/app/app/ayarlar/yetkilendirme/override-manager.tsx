"use client";

import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, CalendarClock, Check, Plus, ShieldCheck, ShieldOff } from "lucide-react";
import { cancelScopeOverride, createScopeOverride, searchScopeResources } from "@/app/actions/access-control";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { OVERRIDE_REASON_MIN, OVERRIDE_RESOURCE_LABELS, OVERRIDE_RESOURCE_TYPES, type OverrideResourceType } from "@/lib/access-control/admin-rules";
import type { ScopeOverride } from "@/lib/access-control/types";
import { formatDateTr } from "@/lib/format";

export type OverrideMember = { id: string; name: string; roleLabel: string; disabled: boolean; disabledReason?: string };
export type OverrideListRow = {
  id: string;
  userId: string;
  userName: string;
  resourceType: ScopeOverride["resource_type"];
  resourceId: string;
  resourceLabel: string;
  resourceHref: string | null;
  allowed: boolean;
  reason: string | null;
  expiresAt: string | null;
  createdByName: string;
  createdAt: string;
  expired: boolean;
};

type ResourceType = OverrideResourceType;

/** Kapsam istisnaları: ekleme formu (arama ile kaynak seçimi) + liste/iptal. Süresi geçenler soluk. */
export function OverrideManager({
  members,
  rows,
  initialUserId,
  canEdit,
  defaultExpiryDate,
  minExpiryDate,
}: {
  members: OverrideMember[];
  rows: OverrideListRow[];
  initialUserId: string | null;
  canEdit: boolean;
  /** YYYY-MM-DD, bugün + 30 gün (sunucudan). */
  defaultExpiryDate: string;
  /** YYYY-MM-DD, yarın (sunucudan). */
  minExpiryDate: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(Boolean(initialUserId));
  const [userId, setUserId] = useState(initialUserId ?? "");
  const [resourceType, setResourceType] = useState<ResourceType>("demand");
  const [resourceId, setResourceId] = useState("");
  const [resourceOptions, setResourceOptions] = useState<ComboboxOption[]>([]);
  const [allowed, setAllowed] = useState(true);
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState(defaultExpiryDate);
  const [unlimited, setUnlimited] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const memberOptions = useMemo<ComboboxOption[]>(
    () => members.map((m) => ({ value: m.id, label: m.name, hint: m.disabled ? `${m.roleLabel} — ${m.disabledReason ?? "istisna tanımlanamaz"}` : m.roleLabel, disabled: m.disabled })),
    [members],
  );

  async function search(q: string): Promise<ComboboxOption[]> {
    const found = await searchScopeResources(resourceType, q);
    setResourceOptions(found);
    return found;
  }

  function submit() {
    setMessage(null);
    if (!userId) return setMessage({ tone: "danger", text: "Üye seçin." });
    if (!resourceId) return setMessage({ tone: "danger", text: "Kaynak seçin (yazarak arayın)." });
    if (reason.trim().length < OVERRIDE_REASON_MIN) return setMessage({ tone: "danger", text: `Gerekçe zorunlu (en az ${OVERRIDE_REASON_MIN} karakter).` });
    const expires_at = unlimited ? null : expires ? new Date(`${expires}T23:59:59+03:00`).toISOString() : null;
    startTransition(async () => {
      const res = await createScopeOverride({ userId, resource_type: resourceType, resource_id: resourceId, allowed, reason: reason.trim(), expires_at });
      if (res.error) setMessage({ tone: "danger", text: res.error });
      else {
        setMessage({ tone: "success", text: allowed ? "Ek erişim izni tanımlandı." : "Erişim yasağı tanımlandı." });
        setResourceId("");
        setReason("");
        setOpen(false);
        router.refresh();
      }
    });
  }

  function cancel(id: string) {
    setBusyId(id);
    startTransition(async () => {
      const res = await cancelScopeOverride(id);
      setBusyId(null);
      if (res.error) setMessage({ tone: "danger", text: res.error });
      else {
        setMessage({ tone: "success", text: "İstisna iptal edildi; süresi geçmiş olarak listede kalır." });
        router.refresh();
      }
    });
  }

  const active = rows.filter((r) => !r.expired);
  const expired = rows.filter((r) => r.expired);

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-ink-950">Kapsam istisnaları</h2>
          <p className="mt-1 text-xs text-text-muted">
            Belirli bir talep, portföy, anlaşma ya da komisyon için kişiye geçici ek erişim verin ya da erişimi yasaklayın. Gerekçe zorunludur; varsayılan süre 30 gündür.
          </p>
        </div>
        {canEdit && !open ? <Button size="sm" icon={Plus} onClick={() => setOpen(true)}>Yeni istisna</Button> : null}
      </div>

      {message ? <Alert tone={message.tone} className="mt-3">{message.text}</Alert> : null}

      {canEdit && open ? (
        <div className="mt-4 space-y-3 rounded-[var(--radius-card)] border border-brand-300 bg-canvas/60 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-text-faint">Üye</label>
              <Combobox options={memberOptions} value={userId} onValueChange={setUserId} placeholder="Üye seçin…" searchPlaceholder="İsimle ara…" emptyText="Üye bulunamadı" aria-label="İstisna tanımlanacak üye" />
            </div>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-text-faint">
              Kaynak türü
              <FormSelect
                value={resourceType}
                onChange={(e) => {
                  setResourceType(e.target.value as ResourceType);
                  setResourceId("");
                  setResourceOptions([]);
                }}
                className="normal-case tracking-normal"
              >
                {OVERRIDE_RESOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>{OVERRIDE_RESOURCE_LABELS[t]}</option>
                ))}
              </FormSelect>
            </label>
            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-text-faint">Kaynak (yazarak ara)</label>
              <Combobox
                key={resourceType}
                options={resourceOptions}
                value={resourceId}
                onValueChange={setResourceId}
                onSearch={search}
                minSearchLength={2}
                placeholder={resourceType === "property" ? "Portföy kodu ya da başlık…" : "Müşteri adı…"}
                searchPlaceholder="En az 2 karakter…"
                emptyText="Kayıt bulunamadı"
                aria-label="İstisna kaynağı"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <fieldset className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-text-faint">
              <legend className="mb-1">Etki</legend>
              <div className="flex gap-1 normal-case tracking-normal">
                <button type="button" onClick={() => setAllowed(true)} className={`focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-3 py-2 text-xs font-semibold transition ${allowed ? "border-mint-500/60 bg-mint-500/10 text-mint-700" : "border-line text-text-muted"}`}>
                  <ShieldCheck className="h-3.5 w-3.5" /> İzin ver
                </button>
                <button type="button" onClick={() => { setAllowed(false); }} className={`focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-3 py-2 text-xs font-semibold transition ${!allowed ? "border-danger-500/60 bg-danger-500/10 text-danger-600" : "border-line text-text-muted"}`}>
                  <ShieldOff className="h-3.5 w-3.5" /> Yasakla
                </button>
              </div>
            </fieldset>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-text-faint">
              <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Bitiş</span>
              <FormInput type="date" value={unlimited ? "" : expires} min={minExpiryDate} disabled={unlimited} onChange={(e) => setExpires(e.target.value)} />
            </label>
            {!allowed ? (
              <label className="inline-flex items-center gap-2 self-end pb-2 text-xs text-text-muted">
                <input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} className="h-4 w-4" /> Süresiz yasak
              </label>
            ) : (
              <p className="self-end pb-2 text-xs text-text-faint">İzin süresiz olamaz (en fazla 365 gün).</p>
            )}
          </div>
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-text-faint">
            Gerekçe (zorunlu)
            <FormTextarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Örn. Müdür izniyle geçici takip; müşteri yurt dışında, danışman Ali Bey yerine bakıyor." className="normal-case tracking-normal" />
          </label>
          <div className="flex gap-2">
            <Button icon={Check} onClick={submit} loading={pending}>Kaydet</Button>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>Vazgeç</Button>
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-5 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
          Henüz kapsam istisnası yok. {canEdit ? "“Yeni istisna” ile bir üyeye belirli bir kayıt için geçici erişim verin." : ""}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <Table className="w-full min-w-[760px] border-collapse text-sm">
            <THead>
              <TR className="border-b border-line text-left text-xs font-bold uppercase tracking-[0.08em] text-text-faint">
                <TH scope="col" className="py-2 pr-3">Üye</TH>
                <TH scope="col" className="px-2 py-2">Kaynak</TH>
                <TH scope="col" className="px-2 py-2">Etki</TH>
                <TH scope="col" className="px-2 py-2">Gerekçe</TH>
                <TH scope="col" className="px-2 py-2">Bitiş</TH>
                <TH scope="col" className="px-2 py-2">Tanımlayan</TH>
                <TH scope="col" className="px-2 py-2 text-right">İşlem</TH>
              </TR>
            </THead>
            <TBody>
              {[...active, ...expired].map((r) => (
                <TR key={r.id} className={`border-b border-line/60 last:border-0 ${r.expired ? "opacity-50" : ""}`}>
                  <TD className="py-2.5 pr-3">
                    <Link href={`/app/ayarlar/yetkilendirme?sekme=kapsamlar`} className="font-semibold text-ink-950 hover:text-brand-600 hover:underline">{r.userName}</Link>
                  </TD>
                  <TD className="px-2 py-2.5">
                    <span className="text-xs text-text-muted">{OVERRIDE_RESOURCE_LABELS[r.resourceType]} · </span>
                    {r.resourceHref ? <Link href={r.resourceHref} className="text-sm font-medium text-brand-600 hover:underline">{r.resourceLabel}</Link> : <span className="text-sm">{r.resourceLabel}</span>}
                  </TD>
                  <TD className="px-2 py-2.5">
                    <Badge variant={r.allowed ? "success" : "danger"} size="sm">{r.allowed ? "İzin" : "Yasak"}</Badge>
                  </TD>
                  <TD className="max-w-64 px-2 py-2.5 text-xs text-text-muted" title={r.reason ?? undefined}>
                    <span className="line-clamp-2">{r.reason ?? "—"}</span>
                  </TD>
                  <TD className="px-2 py-2.5 text-xs">
                    {r.expiresAt ? (
                      <span className={r.expired ? "text-text-muted" : "font-semibold text-amber-600"}>
                        {r.expired ? "Doldu · " : ""}{formatDateTr(r.expiresAt)}
                      </span>
                    ) : (
                      <span className="text-text-muted">Süresiz</span>
                    )}
                  </TD>
                  <TD className="px-2 py-2.5 text-xs text-text-muted">{r.createdByName} · {formatDateTr(r.createdAt)}</TD>
                  <TD className="px-2 py-2.5 text-right">
                    {canEdit && !r.expired ? (
                      <Button size="xs" variant="ghost" icon={Ban} onClick={() => cancel(r.id)} loading={busyId === r.id}>İptal</Button>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </section>
  );
}
