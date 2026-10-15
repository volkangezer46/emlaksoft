"use client";

import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { previewBroadcastSegment, searchTenantsBroadcast, searchTenantUsersBroadcast } from "@/app/actions/platform-notifications";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";

export type SegmentInit = {
  plans?: string[];
  statuses?: string[];
  trialDays?: string;
  loginMode?: string;
  loginDays?: string;
  city?: string;
  module?: string;
  moduleState?: string;
  owners?: boolean;
  tenant?: string;
  tenantLabel?: string;
  user?: string;
  userLabel?: string;
  /** Ofis CRM ölçütleri (PA-11). */
  tags?: string[];
  health?: string[];
  stages?: string[];
  accountOwners?: string[];
  signupDays?: string;
};

export type SegmentOptions = {
  plans: { value: string; label: string }[];
  statuses: { value: string; label: string }[];
  modules: { value: string; label: string }[];
  tenants: ComboboxOption[];
  /** Ofis CRM (AD5) seçenekleri; CRM kurulu değilse boş (ölçütler gizlenir). */
  tags?: { value: string; label: string }[];
  staff?: { value: string; label: string }[];
  healthBands?: { value: string; label: string }[];
  stages?: { value: string; label: string }[];
};

export type SegmentCount = { tenants: number; recipients: number; optedIn: number } | null;

type State = Required<Omit<SegmentInit, "tenantLabel" | "userLabel">>;

function initState(init?: SegmentInit): State {
  return {
    plans: init?.plans ?? [],
    statuses: init?.statuses ?? [],
    trialDays: init?.trialDays ?? "",
    loginMode: init?.loginMode ?? "",
    loginDays: init?.loginDays ?? "",
    city: init?.city ?? "",
    module: init?.module ?? "",
    moduleState: init?.moduleState ?? "on",
    owners: init?.owners ?? false,
    tenant: init?.tenant ?? "",
    user: init?.user ?? "",
    tags: init?.tags ?? [],
    health: init?.health ?? [],
    stages: init?.stages ?? [],
    accountOwners: init?.accountOwners ?? [],
    signupDays: init?.signupDays ?? "",
  };
}

/** Segment durumunu sunucu action'ının okuduğu düz alanlara çevirir (segmentFromForm ile birebir). */
export function segmentFormData(s: State): FormData {
  const fd = new FormData();
  for (const p of s.plans) fd.append("seg_plan", p);
  for (const st of s.statuses) fd.append("seg_status", st);
  if (s.trialDays) fd.set("seg_trial_days", s.trialDays);
  if (s.loginMode && s.loginDays) {
    fd.set("seg_login_mode", s.loginMode);
    fd.set("seg_login_days", s.loginDays);
  }
  if (s.city.trim()) fd.set("seg_city", s.city.trim());
  if (s.module) {
    fd.set("seg_module", s.module);
    fd.set("seg_module_state", s.moduleState);
  }
  if (s.owners) fd.set("seg_owners", "on");
  if (s.tenant) fd.set("seg_tenant", s.tenant);
  if (s.tenant && s.user) fd.set("seg_user", s.user);
  for (const t of s.tags) fd.append("seg_tag", t);
  for (const h of s.health) fd.append("seg_health", h);
  for (const st of s.stages) fd.append("seg_stage", st);
  for (const o of s.accountOwners) fd.append("seg_owner", o);
  if (s.signupDays) fd.set("seg_signup_days", s.signupDays);
  return fd;
}

/** Segment durumunu URL sorgu dizgesine çevirir ("Bu segmente duyuru / banner" bağlantıları). */
export function segmentQuery(s: State): string {
  const q = new URLSearchParams();
  for (const [k, v] of segmentFormData(s).entries()) q.append(k, String(v));
  return q.toString();
}

function Chip({ name, value, label, checked, onToggle }: { name: string; value: string; label: string; checked: boolean; onToggle: () => void }) {
  return (
    <label className="cursor-pointer">
      <input type="checkbox" name={name} value={value} checked={checked} onChange={onToggle} className="peer sr-only" />
      <span className="inline-flex min-h-9 touch:min-h-11 items-center rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted transition peer-checked:border-brand-600 peer-checked:bg-brand-600/10 peer-checked:text-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500">
        {label}
      </span>
    </label>
  );
}

/**
 * Segment oluşturucu (AD8): plan, durum, deneme bitişine kalan gün, son giriş, il, modül, rol (yalnız sahipler),
 * tek ofis ve (izinliyse) tek kullanıcı; Ofis CRM ölçütleri (PA-11): etiket, sağlık bandı, yaşam döngüsü aşaması, sorumlu
 * personel ve kayıt yaşı. Alanlar formun içinde `seg_*` adıyla gider; sayım önizlemesi 400 ms sonra sunucuda canlı
 * hesaplanır (gönderim anında segment YENİDEN çözülür). Ölçüt içindeki seçenekler VEYA, ölçütler VE ile birleşir.
 */
export function SegmentBuilder({
  init,
  options,
  allowUser = true,
  allowOwners = true,
  onChange,
}: {
  init?: SegmentInit;
  options: SegmentOptions;
  allowUser?: boolean;
  allowOwners?: boolean;
  onChange?: (info: { state: State; count: SegmentCount; query: string }) => void;
}) {
  const [s, setS] = useState<State>(() => initState(init));
  const [count, setCount] = useState<SegmentCount>(null);
  const [counting, setCounting] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);
  const seq = useRef(0);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const set = <K extends keyof State>(k: K, v: State[K]) => setS((prev) => ({ ...prev, [k]: v, ...(k === "tenant" ? { user: "" } : {}) }));
  const toggle = (k: "plans" | "statuses" | "tags" | "health" | "stages" | "accountOwners", v: string) =>
    setS((prev) => ({ ...prev, [k]: prev[k].includes(v) ? prev[k].filter((x) => x !== v) : [...prev[k], v] }));

  useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(() => {
      setCounting(true);
      void previewBroadcastSegment(segmentFormData(s)).then((r) => {
        if (my !== seq.current) return;
        setCounting(false);
        if (r.error) {
          setCountError(r.error);
          setCount(null);
          onChangeRef.current?.({ state: s, count: null, query: segmentQuery(s) });
          return;
        }
        const c = { tenants: r.tenants ?? 0, recipients: r.recipients ?? 0, optedIn: r.optedIn ?? 0 };
        setCountError(null);
        setCount(c);
        onChangeRef.current?.({ state: s, count: c, query: segmentQuery(s) });
      });
    }, 400);
    return () => clearTimeout(t);
  }, [s]);

  return (
    <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
      <div className="sm:col-span-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-brand-600/20 bg-brand-600/5 px-3 py-2 text-sm" aria-live="polite">
        <Users className="h-4 w-4 text-brand-600" />
        {countError ? (
          <span className="font-semibold text-danger-600">{countError}</span>
        ) : count ? (
          <span className={counting ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <strong className="numeric text-ink-950">{count.tenants}</strong> ofis · <strong className="numeric text-ink-950">{count.recipients}</strong> alıcı
            <span className="text-text-muted"> (pazarlama izinli {count.optedIn})</span>
          </span>
        ) : (
          <span className="text-text-muted">Sayılıyor…</span>
        )}
      </div>

      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-sm font-medium text-ink-950">Durum</legend>
        <div className="flex flex-wrap gap-2">
          {options.statuses.map((o) => (
            <Chip key={o.value} name="seg_status" value={o.value} label={o.label} checked={s.statuses.includes(o.value)} onToggle={() => toggle("statuses", o.value)} />
          ))}
        </div>
      </fieldset>
      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-sm font-medium text-ink-950">Plan</legend>
        <div className="flex flex-wrap gap-2">
          {options.plans.map((o) => (
            <Chip key={o.value} name="seg_plan" value={o.value} label={o.label} checked={s.plans.includes(o.value)} onToggle={() => toggle("plans", o.value)} />
          ))}
        </div>
      </fieldset>

      {options.healthBands?.length ? (
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-ink-950">Sağlık skoru</legend>
          <div className="flex flex-wrap gap-2">
            {options.healthBands.map((o) => (
              <Chip key={o.value} name="seg_health" value={o.value} label={o.label} checked={s.health.includes(o.value)} onToggle={() => toggle("health", o.value)} />
            ))}
          </div>
        </fieldset>
      ) : null}
      {options.stages?.length ? (
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-ink-950">Yaşam döngüsü aşaması</legend>
          <div className="flex flex-wrap gap-2">
            {options.stages.map((o) => (
              <Chip key={o.value} name="seg_stage" value={o.value} label={o.label} checked={s.stages.includes(o.value)} onToggle={() => toggle("stages", o.value)} />
            ))}
          </div>
        </fieldset>
      ) : null}
      {options.tags?.length ? (
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-ink-950">Ofis etiketi <span className="font-normal text-text-muted">(herhangi biri)</span></legend>
          <div className="flex flex-wrap gap-2">
            {options.tags.map((o) => (
              <Chip key={o.value} name="seg_tag" value={o.value} label={o.label} checked={s.tags.includes(o.value)} onToggle={() => toggle("tags", o.value)} />
            ))}
          </div>
        </fieldset>
      ) : null}
      {options.staff?.length ? (
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-ink-950">Sorumlu personel</legend>
          <div className="flex flex-wrap gap-2">
            {[{ value: "yok", label: "Atanmamış" }, ...options.staff].map((o) => (
              <Chip key={o.value} name="seg_owner" value={o.value} label={o.label} checked={s.accountOwners.includes(o.value)} onToggle={() => toggle("accountOwners", o.value)} />
            ))}
          </div>
        </fieldset>
      ) : null}

      <FormField label="Kayıt yaşı (en çok gün)" htmlFor="seg_signup_days" hint="Örn. 14: son 14 günde kayıt olan ofisler">
        <FormInput id="seg_signup_days" name="seg_signup_days" type="number" inputMode="numeric" min={1} max={365} value={s.signupDays} onChange={(e) => set("signupDays", e.target.value)} placeholder="Boş: ölçüt yok" />
      </FormField>
      <FormField label="Deneme bitişine kalan gün (en çok)" htmlFor="seg_trial_days" hint="Örn. 3: denemesi 3 gün içinde bitecek ofisler">
        <FormInput id="seg_trial_days" name="seg_trial_days" type="number" inputMode="numeric" min={0} max={60} value={s.trialDays} onChange={(e) => set("trialDays", e.target.value)} placeholder="Boş: ölçüt yok" />
      </FormField>
      <FormField label="İl" htmlFor="seg_city" hint="Virgülle birden çok il">
        <FormInput id="seg_city" name="seg_city" maxLength={300} value={s.city} onChange={(e) => set("city", e.target.value)} placeholder="Örn. İstanbul, Ankara" />
      </FormField>

      <FormField label="Son giriş" htmlFor="seg_login_mode">
        <FormSelect id="seg_login_mode" name="seg_login_mode" value={s.loginMode} onChange={(e) => set("loginMode", e.target.value)}>
          <option value="">Ölçüt yok</option>
          <option value="active">Son N günde giriş yapan</option>
          <option value="inactive">N gündür giriş yapmayan</option>
        </FormSelect>
      </FormField>
      <FormField label="Gün (N)" htmlFor="seg_login_days">
        <FormInput id="seg_login_days" name="seg_login_days" type="number" inputMode="numeric" min={1} max={365} value={s.loginDays} onChange={(e) => set("loginDays", e.target.value)} disabled={!s.loginMode} placeholder="Örn. 14" />
      </FormField>

      <FormField label="Modül kullanımı" htmlFor="seg_module">
        <FormSelect id="seg_module" name="seg_module" value={s.module} onChange={(e) => set("module", e.target.value)}>
          <option value="">Ölçüt yok</option>
          {options.modules.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </FormSelect>
      </FormField>
      <FormField label="Modül durumu" htmlFor="seg_module_state">
        <FormSelect id="seg_module_state" name="seg_module_state" value={s.moduleState} onChange={(e) => set("moduleState", e.target.value)} disabled={!s.module}>
          <option value="on">Açık olan ofisler</option>
          <option value="off">Kapalı olan ofisler</option>
        </FormSelect>
      </FormField>

      <FormField label="Tek ofis (isteğe bağlı)" htmlFor="seg_tenant" inject={false}>
        <Combobox
          id="seg_tenant"
          name="seg_tenant"
          options={options.tenants}
          value={s.tenant}
          selectedLabel={init?.tenant === s.tenant ? init?.tenantLabel : undefined}
          onValueChange={(v) => set("tenant", v)}
          onSearch={searchTenantsBroadcast}
          placeholder="Tüm eşleşen ofisler"
          searchPlaceholder="Ofis adı yazın…"
          emptyText="Eşleşen ofis yok"
        />
      </FormField>
      {allowUser ? (
        <FormField label="Tek kullanıcı (doğrudan mesaj)" htmlFor="seg_user" inject={false} hint={s.tenant ? undefined : "Önce ofis seçin"}>
          <Combobox
            key={s.tenant || "yok"}
            id="seg_user"
            name="seg_user"
            options={[]}
            value={s.user}
            selectedLabel={init?.user === s.user ? init?.userLabel : undefined}
            disabled={!s.tenant}
            onValueChange={(v) => set("user", v)}
            onSearch={(q) => searchTenantUsersBroadcast(s.tenant, q)}
            minSearchLength={0}
            placeholder="Ofisin tüm alıcıları"
            searchPlaceholder="Kullanıcı adı yazın…"
            emptyText="Eşleşen kullanıcı yok"
          />
        </FormField>
      ) : null}

      {allowOwners ? (
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-950 sm:col-span-2">
          <input type="checkbox" name="seg_owners" checked={s.owners} onChange={(e) => set("owners", e.target.checked)} disabled={Boolean(s.user)} className="h-4 w-4 accent-[var(--brand-600)]" />
          Yalnız ofis sahiplerine gönder
        </label>
      ) : null}
    </div>
  );
}
