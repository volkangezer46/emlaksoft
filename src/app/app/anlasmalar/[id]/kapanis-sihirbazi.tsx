"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { Check, Plus, ThumbsDown, Trash2, Trophy } from "lucide-react";
import { updateDeal, updateDealStage } from "@/app/actions/deals";
import { updateCommissionSplits } from "@/app/actions/commissions";
import { getDealCommissionRef } from "@/app/actions/deal-close";
import { updatePropertyCommissionRate } from "@/app/actions/property-commission-rate";
import { createTask } from "@/app/actions/tasks";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { MoneyInput } from "@/components/ui/money-input";
import { Wizard, WizardCheckbox, WizardPanelGroup, WizardStat, type WizardApi } from "@/components/ui/wizard/wizard";
import type { WizardValues } from "@/components/ui/wizard/engine";
import { formatTry } from "@/lib/format";
import { formatMoneyValue } from "@/lib/money-typing";
import { decodeSplits, defaultSplits, encodeSplits, parseMoney, parsePercent, salePreview, type SplitInput } from "@/lib/sihirbaz/hesap";
import { initialOutcome, isReadyToWin, wonReadiness, closingTabHref, type ClosingOutcome } from "./kapanis-model";
import { LOST_DRAFT_FIELDS, WON_DRAFT_FIELDS, lostPlan, lostSteps, wonPlan, wonSteps, type WonContext } from "./kapanis-adimlar";
import { KapanisSonrasi, rememberPostClose } from "./kapanis-sonrasi";

export type KapanisProps = {
  dealId: string;
  stage: string;
  dealType: string;
  dealValue: number | null;
  propertyId: string | null;
  propertyTitle: string | null;
  customerId: string | null;
  customerName: string | null;
  lossOptions: { value: string; label: string }[];
  /** Kayıtlı kayıp nedeni (biçimlenmiş metin) — yalnız kaybedilmiş anlaşmada. */
  lossReasonText: string | null;
  canEdit: boolean;
  canCreate: boolean;
  canCreateTask: boolean;
  canSurvey: boolean;
  /** Para değerleri (komisyon, paylar): yalnız kendi anlaşması veya earnings_all. */
  showMoney: boolean;
  survey: { url: string; answered: boolean; score: number | null } | null;
  /** Panodan veya "Geçiş" menüsünden gelen ön seçim (`?sonuc=`); kapanmış anlaşmada yok sayılır. */
  requestedOutcome?: ClosingOutcome | null;
  /** Taslak anahtarı (kullanıcı başına). */
  userId: string;
  /** Portföy düzenleme izni (oran yoksa sihirbazdan girilir). */
  canSetRate: boolean;
  /** WP2: owner/gm dışındaki rol → Kazanıldı ve paylaşım yönetici onayına gider. */
  needsApproval: boolean;
  propertyStatusLabel: string | null;
  // Aşağıdakiler KapanisPanel (sunucu) tarafından doldurulur.
  commissionRate?: number | null;
  /** Ofis Tanımları Merkezi: pay kaydedilmemiş anlaşmada önerilen danışman payı (varsayılan 50). */
  defaultAdvisorShare?: number;
  commission?: { id: string; gross: number; vat: number; status: string; splits: { label: string; rate: number }[] } | null;
  checklist?: { done: number; total: number };
  hasCollectionTask?: boolean;
  defaultDue?: string;
  /** Anlaşmaya bağlı sözleşmeler (Sözleşme adımı). */
  contracts?: { id: string; title: string; statusLabel: string }[];
};

/**
 * Anlaşma kapanışı — detay sayfasında "Kapanış" sekmesi (popup DEĞİL), ortak Sihirbaz çatısı üzerinde.
 * Açık anlaşmada sonuç seçilir (Kazanıldı / Kaybedildi), ardından adımlar; TEK "Onayla" ile plan (kapanis-adimlar.ts)
 * MEVCUT action'ları çağırır. Kapanmış anlaşmada kapanış sonrası işler (paylar, vade, evrak, anket) gösterilir.
 */
export function KapanisSihirbazi(props: KapanisProps) {
  // Pano bir kartı Kazanıldı/Kaybedildi'ye bıraktığında buraya `?sonuc=` ile gelinir: ilgili akış seçili açılır.
  // Aşama burada DEĞİŞMEZ; yalnız sihirbazın "Onayla"sı updateDealStage'i çağırır.
  const startOutcome = initialOutcome(props.stage, props.requestedOutcome);
  const [outcome, setOutcome] = useState<ClosingOutcome | null>(startOutcome);

  if (props.stage === "won" || props.stage === "lost") return <KapanisSonrasi {...props} />;

  if (outcome === null) {
    return (
      <section className="surface-card rounded-[var(--radius-panel)] p-5">
        <h2 className="font-display font-bold text-ink-950">Anlaşmayı kapatın</h2>
        <p className="mt-0.5 text-sm text-text-muted">Sonucu seçin; sihirbaz her adımda ne yapılacağını söyler.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            icon={<Trophy className="h-5 w-5" aria-hidden />}
            title="Kazanıldı"
            text="Nihai fiyat, komisyon payları, portföy durumu, sözleşme ve tahsilat vadesi."
            tone="gold"
            onClick={() => setOutcome("won")}
          />
          <ChoiceCard
            icon={<ThumbsDown className="h-5 w-5" aria-hidden />}
            title="Kaybedildi"
            text="Kayıp nedeni, rakip/fiyat notu ve geri kazanım için takip görevi."
            tone="neutral"
            onClick={() => setOutcome("lost")}
          />
        </div>
      </section>
    );
  }

  const change = (
    <Button variant="ghost" size="sm" onClick={() => setOutcome(null)}>
      Sonucu değiştir
    </Button>
  );
  return outcome === "won" ? (
    <WonWizard {...props} change={change} />
  ) : (
    <LostWizard {...props} change={change} />
  );
}

function ChoiceCard({ icon, title, text, tone, onClick }: { icon: ReactNode; title: string; text: string; tone: "gold" | "neutral"; onClick: () => void }) {
  return (
    <Button variant="outline" onClick={onClick} className="h-auto min-h-11 items-start justify-start gap-3 rounded-[var(--radius-card)] p-4 text-left font-normal hover:border-[var(--gold-400)]">
      <span
        className={
          "grid h-10 w-10 shrink-0 place-items-center rounded-full " +
          (tone === "gold" ? "bg-[var(--navy-900)] text-[var(--gold-300)]" : "bg-line text-text-muted")
        }
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink-950">{title}</span>
        <span className="mt-0.5 block whitespace-normal text-xs text-text-muted">{text}</span>
      </span>
    </Button>
  );
}

// ---------------------------------------------------------------- Kazanıldı

function WonWizard(p: KapanisProps & { change: ReactNode }) {
  const ctx: WonContext = useMemo(
    () => ({
      dealId: p.dealId,
      dealType: p.dealType,
      propertyId: p.propertyId,
      propertyTitle: p.propertyTitle,
      propertyStatusLabel: p.propertyStatusLabel,
      customerId: p.customerId,
      customerName: p.customerName,
      dealValue: p.dealValue,
      commissionRate: p.commissionRate ?? null,
      showMoney: p.showMoney,
      canSetRate: p.canSetRate,
      canCreateTask: p.canCreateTask,
      hasCollectionTask: Boolean(p.hasCollectionTask),
      needsApproval: p.needsApproval,
    }),
    [p.dealId, p.dealType, p.propertyId, p.propertyTitle, p.propertyStatusLabel, p.customerId, p.customerName, p.dealValue, p.commissionRate, p.showMoney, p.canSetRate, p.canCreateTask, p.hasCollectionTask, p.needsApproval],
  );
  const steps = useMemo(() => wonSteps(ctx), [ctx]);
  const initialValues = useMemo<WizardValues>(
    () => ({
      deal_value: formatMoneyValue(p.dealValue ?? null),
      commission_rate: "",
      splits: encodeSplits(defaultSplits(p.defaultAdvisorShare)),
      due_at: p.hasCollectionTask ? "" : (p.defaultDue ?? ""),
      confirm_property: "",
    }),
    [p.dealValue, p.defaultAdvisorShare, p.hasCollectionTask, p.defaultDue],
  );
  const blocked = !(p.canCreate && p.canEdit) ? "Kazanmak için anlaşma düzenleme ve komisyon oluşturma yetkisi gerekir." : null;

  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-4 sm:p-5">
      <div className="mb-2 flex justify-end">{p.change}</div>
      <Wizard
        id={`kapanis-${p.dealId}`}
        userId={p.userId}
        variant="embedded"
        title="Satışı kapat"
        description="Nihai fiyat, paylar, portföy durumu ve sözleşme; tek onayla kapanış."
        steps={steps}
        initialValues={initialValues}
        draftFields={WON_DRAFT_FIELDS}
        cancelHref={`/app/anlasmalar/${p.dealId}`}
        submitLabel={p.needsApproval ? "Onaya gönder ve kapat" : "Onayla ve kapat"}
        submitBlocked={blocked}
        renderStep={(id, api) => <WonStep id={id} api={api} p={p} />}
        aside={(api) => <WonAside v={api.values} p={p} />}
        reviewExtra={() =>
          p.needsApproval ? (
            <p className="tone-warning rounded-[var(--radius-control)] px-3 py-2 text-xs">
              Rolünüzde “Kazanıldı” yönetici onayıyla yapılır: ilk onayda talep iletilir, onay gelince aynı düğmeyle kapanış tamamlanır.
              Bilgileriniz taslakta saklanır.
            </p>
          ) : null
        }
        plan={(v, { skipped }) =>
          wonPlan(v, skipped, ctx, {
            updateDeal,
            setRate: async (pid, rate) => {
              const r = await updatePropertyCommissionRate(pid, rate);
              return r.ok ? { ok: true } : { ok: false, error: r.error };
            },
            win: async (fd) => {
              const res = await updateDealStage(fd);
              // Kapanış sonrası temizlik özeti, sekme yeniden çizilince (KapanisSonrasi) bir kez gösterilir.
              if (!res.error && res.postClose) rememberPostClose(p.dealId, res.postClose);
              return res;
            },
            commissionId: getDealCommissionRef,
            saveSplits: (id, rows) => updateCommissionSplits(id, rows),
            createTask: (fd) => createTask({}, fd),
          })
        }
        onComplete={(_ctx, notes) => ({
          href: closingTabHref(p.dealId, "won"),
          message: ["Tebrikler, anlaşma kazanıldı olarak kapandı.", ...notes].join(" "),
        })}
        partialHref={() => `/app/anlasmalar/${p.dealId}`}
      />
    </section>
  );
}

function WonStep({ id, api, p }: { id: string; api: WizardApi; p: KapanisProps }) {
  const v = api.values;
  if (id === "tutar") {
    const needsRate = p.showMoney && !(p.commissionRate && p.commissionRate > 0);
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Nihai tutar (₺)" htmlFor="wz-won-value" required error={api.error("wz-won-value")} hint={p.dealValue ? `Kayıtlı tutar ${formatTry(p.dealValue)}.` : "Komisyon bu tutardan hesaplanır."}>
          <MoneyInput id="wz-won-value" value={v.deal_value} onValueChange={(t) => api.set("deal_value", t)} disabled={!p.canEdit} />
        </FormField>
        {needsRate ? (
          p.canSetRate ? (
            <FormField label="Komisyon oranı (%)" htmlFor="wz-won-rate" required error={api.error("wz-won-rate")} hint="Portföyde oran tanımlı değil; onayla birlikte portföye yazılır.">
              <FormInput id="wz-won-rate" inputMode="decimal" autoComplete="off" placeholder="ör. 2" value={v.commission_rate} onChange={(e) => api.set("commission_rate", e.target.value)} />
            </FormField>
          ) : (
            <div className="sm:col-span-2">
              <Alert tone="warning">Portföyde komisyon oranı tanımlı değil; portföy sorumlusu oranı girmeden kapanış yapılamaz.</Alert>
              {api.error("wz-won-rate") ? <p id="wz-won-rate" tabIndex={-1} className="mt-1 text-xs font-medium text-danger-600">{api.error("wz-won-rate")}</p> : null}
            </div>
          )
        ) : null}
        {!p.canEdit ? <p className="text-xs text-text-muted sm:col-span-2">Tutarı düzenlemek için anlaşma düzenleme yetkisi gerekir.</p> : null}
        <div className="sm:col-span-2 xl:hidden">
          <WonCommission v={v} p={p} />
        </div>
      </div>
    );
  }
  if (id === "paylar") return <SplitEditor api={api} p={p} />;
  if (id === "portfoy") {
    const rate = p.commissionRate && p.commissionRate > 0 ? p.commissionRate : parsePercent(v.commission_rate);
    const items = wonReadiness(
      { dealType: p.dealType, hasProperty: Boolean(p.propertyId), hasCustomer: Boolean(p.customerId), dealValue: parseMoney(v.deal_value), commissionRate: rate },
      { dealId: p.dealId, propertyId: p.propertyId },
    ).filter((i) => p.showMoney || i.key !== "rate");
    const ready = isReadyToWin(items);
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/50 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink-950">{p.propertyTitle ?? "Portföy bağlı değil"}</p>
            <p className="text-xs text-text-muted">
              Şimdi: <strong className="text-ink-950">{p.propertyStatusLabel ?? "—"}</strong> → kapanışta <strong className="text-ink-950">Satıldı</strong>
            </p>
          </div>
        </div>
        <ul id="wz-won-ready" tabIndex={-1} className="divide-y divide-line rounded-[var(--radius-card)] border border-line outline-none" aria-label="Kapanış ön koşulları">
          {items.map((i) => (
            <li key={i.key} className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm">
              <span className={"grid h-5 w-5 shrink-0 place-items-center rounded-full " + (i.ok ? "bg-[var(--gold-400)] text-[var(--gold-ink)]" : "bg-line text-text-faint")} aria-hidden>
                {i.ok ? <Check className="h-3 w-3" /> : null}
              </span>
              <span className="min-w-0 flex-1 text-ink-950">{i.label}<span className="sr-only">{i.ok ? ": tamam" : ": eksik"}</span></span>
              {!i.ok && i.href ? (
                <Link href={i.href} className="focus-ring inline-flex min-h-11 items-center text-xs font-semibold text-brand-600 hover:underline">Düzelt</Link>
              ) : null}
            </li>
          ))}
        </ul>
        {api.error("wz-won-ready") && !ready ? <p className="text-xs font-medium text-danger-600">{api.error("wz-won-ready")}</p> : null}
        <WizardCheckbox
          id="wz-won-confirm"
          checked={v.confirm_property === "1"}
          onChange={(on) => api.set("confirm_property", on ? "1" : "")}
          title="Portföy “Satıldı” olarak işaretlensin, komisyon kaydı açılsın"
          text="Geri almak için komisyon silme yetkisi gerekir; tahsil edilmiş komisyon geri açılmaz."
          error={api.error("wz-won-confirm")}
        />
      </div>
    );
  }
  if (id === "belgeler") {
    const c = p.checklist ?? { done: 0, total: 0 };
    const contracts = p.contracts ?? [];
    return (
      <div className="space-y-4">
        <WizardPanelGroup title="Satış sözleşmesi">
          {contracts.length > 0 ? (
            <ul className="space-y-1">
              {contracts.map((k) => (
                <li key={k.id} className="flex min-h-11 items-center gap-2 px-1 text-sm">
                  <Link href={`/app/sozlesmeler/${k.id}`} className="focus-ring min-w-0 flex-1 truncate font-semibold text-brand-700 hover:underline">{k.title}</Link>
                  <span className="shrink-0 text-xs text-text-muted">{k.statusLabel}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 text-xs text-text-muted">Anlaşmaya bağlı sözleşme yok. Taslağı hazırlayıp imzaya gönderebilirsiniz; sihirbaz taslakta bekler.</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2 px-1">
            <ButtonLink href={`/app/sozlesmeler/yeni?anlasma=${p.dealId}`} size="sm" variant="secondary">Sözleşme hazırla</ButtonLink>
            <ButtonLink href={`/app/anlasmalar/${p.dealId}?sekme=belgeler`} size="sm" variant="ghost">
              Evrak dosyası {c.total > 0 ? `(${c.done}/${c.total})` : ""}
            </ButtonLink>
          </div>
        </WizardPanelGroup>
        {p.canCreateTask && !p.hasCollectionTask ? (
          <FormField label="Komisyon tahsilat vadesi" htmlFor="wz-won-due" hint="Bu tarihte hatırlatan yüksek öncelikli görev açılır. Boş bırakılırsa görev açılmaz.">
            <FormInput id="wz-won-due" type="datetime-local" value={v.due_at} onChange={(e) => api.set("due_at", e.target.value)} />
          </FormField>
        ) : p.hasCollectionTask ? (
          <p className="text-xs text-text-muted">Tahsilat görevi zaten açık.</p>
        ) : null}
      </div>
    );
  }
  return null;
}

function SplitEditor({ api, p }: { api: WizardApi; p: KapanisProps }) {
  const rows = decodeSplits(api.values.splits);
  const list: SplitInput[] = rows.length > 0 ? rows : [{ label: "", rate: "" }];
  const setRows = (next: SplitInput[]) => api.set("splits", encodeSplits(next));
  const value = parseMoney(api.values.deal_value);
  const rate = p.commissionRate && p.commissionRate > 0 ? p.commissionRate : parsePercent(api.values.commission_rate);
  const preview = salePreview(value, rate, list);
  const total = list.reduce((a, r) => a + (Number(String(r.rate).replace(",", ".")) || 0), 0);
  return (
    <div className="space-y-3">
      {p.needsApproval ? (
        <p className="tone-warning rounded-[var(--radius-control)] px-3 py-2 text-xs">Paylaşım değişikliği yönetici onayına gider; onaylanana kadar ofis varsayılan payları geçerlidir.</p>
      ) : null}
      <div className="space-y-2">
        {list.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <FormInput
              aria-label={`Pay ${i + 1} taraf`}
              value={r.label}
              onChange={(e) => setRows(list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              placeholder="Taraf (Danışman, Ofis, Referans)"
              className="min-w-0 flex-1"
            />
            <div className="relative w-20 shrink-0 sm:w-24">
              <FormInput
                id={`wz-split-${i}-rate`}
                aria-label={`Pay ${i + 1} oran`}
                inputMode="decimal"
                value={r.rate}
                onChange={(e) => setRows(list.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))}
                className="pr-6"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-faint">%</span>
            </div>
            <span className="numeric hidden w-28 shrink-0 truncate text-right text-xs font-semibold text-ink-950 sm:block">
              {preview ? formatTry(preview.rows.find((x) => x.label === r.label.trim())?.amount ?? 0) : "—"}
            </span>
            <Button type="button" variant="ghost" size="icon" aria-label="Satırı sil" icon={Trash2} disabled={list.length <= 1} onClick={() => setRows(list.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" icon={Plus} onClick={() => setRows([...list, { label: "", rate: "" }])}>
          Pay ekle
        </Button>
        <p className={"numeric text-xs font-semibold " + (total > 100.01 ? "text-danger-600" : Math.abs(total - 100) < 0.01 ? "text-[var(--pm-success-text)]" : "text-text-muted")}>
          Toplam %{Math.round(total * 100) / 100} {total < 100 ? `(ofiste kalan %${Math.round((100 - total) * 100) / 100})` : ""}
        </p>
      </div>
      {api.error("wz-split-0-rate") ? <p className="text-xs font-medium text-danger-600">{api.error("wz-split-0-rate")}</p> : null}
      <div className="xl:hidden">
        <WonCommission v={api.values} p={p} />
      </div>
    </div>
  );
}

function WonCommission({ v, p }: { v: WizardValues; p: KapanisProps }) {
  if (!p.showMoney) return null;
  const rate = p.commissionRate && p.commissionRate > 0 ? p.commissionRate : parsePercent(v.commission_rate);
  const preview = salePreview(parseMoney(v.deal_value), rate, decodeSplits(v.splits));
  if (!preview) {
    return (
      <WizardPanelGroup title="Komisyon">
        <p className="px-1 text-xs text-text-muted">Tutar ve oran girilince hesaplanır.</p>
      </WizardPanelGroup>
    );
  }
  return (
    <WizardPanelGroup title={`Komisyon (%${String(rate).replace(".", ",")})`}>
      <WizardStat label="KDV hariç" value={formatTry(preview.net)} />
      <WizardStat label="KDV" value={formatTry(preview.vat)} />
      <WizardStat label="Tahsil edilecek" value={formatTry(preview.gross)} strong />
      <div className="my-1 border-t border-line" />
      {preview.rows.map((r) => (
        <WizardStat key={r.label} label={`${r.label} (%${String(r.rate).replace(".", ",")})`} value={formatTry(r.amount)} />
      ))}
      {preview.remainderRate > 0 ? <WizardStat label={`Ofiste kalan (%${String(preview.remainderRate).replace(".", ",")})`} value={formatTry(preview.remainderAmount)} muted /> : null}
    </WizardPanelGroup>
  );
}

function WonAside({ v, p }: { v: WizardValues; p: KapanisProps }) {
  const value = parseMoney(v.deal_value);
  return (
    <>
      <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
        <p className="line-clamp-2 text-sm font-semibold text-ink-950">{p.propertyTitle ?? "Portföy"}</p>
        <p className="mt-0.5 truncate text-xs text-text-muted">{p.customerName ?? "Müşteri"}</p>
        <p className="numeric mt-2 text-lg font-bold text-ink-950">{value != null ? formatTry(value) : "Tutar girilmedi"}</p>
        {p.dealValue != null && value != null && value !== p.dealValue ? (
          <p className="numeric text-xs text-text-muted">Kayıtlı {formatTry(p.dealValue)} · fark {formatTry(value - p.dealValue)}</p>
        ) : null}
      </div>
      <WonCommission v={v} p={p} />
    </>
  );
}

// ---------------------------------------------------------------- Kaybedildi

function LostWizard(p: KapanisProps & { change: ReactNode }) {
  const ctx = useMemo(
    () => ({ dealId: p.dealId, customerId: p.customerId, propertyId: p.propertyId, canCreateTask: p.canCreateTask }),
    [p.dealId, p.customerId, p.propertyId, p.canCreateTask],
  );
  const labels = useMemo(() => new Map(p.lossOptions.map((o) => [o.value, o.label])), [p.lossOptions]);
  const steps = useMemo(() => lostSteps(ctx, (val) => labels.get(val) ?? val), [ctx, labels]);
  const initialValues = useMemo<WizardValues>(
    () => ({
      loss_reason: "",
      loss_competitor: "",
      loss_price: "",
      loss_extra: "",
      takip: "",
      takip_title: `Geri kazanım: ${p.customerName ?? "müşteri"} ile yeniden görüş`,
      takip_due: p.defaultDue ?? "",
    }),
    [p.customerName, p.defaultDue],
  );
  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-4 sm:p-5">
      <div className="mb-2 flex justify-end">{p.change}</div>
      <Wizard
        id={`kayip-${p.dealId}`}
        userId={p.userId}
        variant="embedded"
        title="Kaybedildi olarak kapat"
        description="Kayıp nedeni ve geri kazanım takibi."
        steps={steps}
        initialValues={initialValues}
        draftFields={LOST_DRAFT_FIELDS}
        cancelHref={`/app/anlasmalar/${p.dealId}`}
        submitLabel="Onayla ve kapat"
        submitBlocked={p.canEdit ? null : "Anlaşmayı kapatmak için düzenleme yetkisi gerekir."}
        renderStep={(id, api) => <LostStep id={id} api={api} p={p} />}
        plan={(v, { skipped }) => lostPlan(v, skipped, ctx, { lose: updateDealStage, createTask: (fd) => createTask({}, fd) })}
        onComplete={(_c, notes) => ({ href: closingTabHref(p.dealId, "lost"), message: ["Anlaşma kaybedildi olarak kapandı.", ...notes].join(" ") })}
        partialHref={() => `/app/anlasmalar/${p.dealId}`}
      />
    </section>
  );
}

function LostStep({ id, api, p }: { id: string; api: WizardApi; p: KapanisProps }) {
  const v = api.values;
  if (id === "neden") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Kayıp nedeni" htmlFor="wz-lost-reason" required className="sm:col-span-2" error={api.error("wz-lost-reason")}>
          <FormSelect id="wz-lost-reason" value={v.loss_reason} onChange={(e) => api.set("loss_reason", e.target.value)}>
            <option value="">Seçin</option>
            {p.lossOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </FormSelect>
        </FormField>
        <FormField label="Rakip (isteğe bağlı)" htmlFor="wz-lost-competitor">
          <FormInput id="wz-lost-competitor" value={v.loss_competitor} onChange={(e) => api.set("loss_competitor", e.target.value)} placeholder="Hangi ofis/kişi aldı?" />
        </FormField>
        <FormField label="Fiyat notu (isteğe bağlı)" htmlFor="wz-lost-price">
          <FormInput id="wz-lost-price" value={v.loss_price} onChange={(e) => api.set("loss_price", e.target.value)} placeholder="Ör. %5 daha ucuz teklif aldı" />
        </FormField>
        <FormField label={`Ek açıklama ${v.loss_reason === "diger" ? "(zorunlu)" : "(isteğe bağlı)"}`} htmlFor="wz-lost-extra" className="sm:col-span-2" error={api.error("wz-lost-extra")}>
          <FormTextarea id="wz-lost-extra" rows={2} value={v.loss_extra} onChange={(e) => api.set("loss_extra", e.target.value)} />
        </FormField>
      </div>
    );
  }
  if (id === "takip") {
    const on = v.takip === "1";
    return (
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <WizardCheckbox className="sm:col-span-2" checked={on} onChange={(c) => api.set("takip", c ? "1" : "")} title="Geri kazanım görevi aç" />
        {on ? (
          <>
            <FormField label="Görev" htmlFor="wz-lost-task" error={api.error("wz-lost-task")}>
              <FormInput id="wz-lost-task" value={v.takip_title} onChange={(e) => api.set("takip_title", e.target.value)} />
            </FormField>
            <FormField label="Tarih" htmlFor="wz-lost-due">
              <FormInput id="wz-lost-due" type="datetime-local" value={v.takip_due} onChange={(e) => api.set("takip_due", e.target.value)} />
            </FormField>
          </>
        ) : null}
      </div>
    );
  }
  return null;
}
