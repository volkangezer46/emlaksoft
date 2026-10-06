"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Lock, Plus, ThumbsDown, Trophy, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Celebrate } from "@/components/ui/celebrate";
import { FormInput, FormSelect, FormTextarea, fieldClass } from "@/components/ui/form-controls";
import { updateDeal, updateDealStage } from "@/app/actions/deals";
import { updateCommissionSplits } from "@/app/actions/commissions";
import { createTask } from "@/app/actions/tasks";
import { calculateCommission } from "@/lib/commission";
import { CopySurveyLinkButton, CreateSurveyButton } from "../../raporlar/memnuniyet/survey-actions";
import {
  COLLECTION_TASK_PREFIX,
  advisorShareOf,
  buildLossNote,
  initialOutcome,
  initialStep,
  isReadyToWin,
  isStepUnlocked,
  splitsError,
  splitsTotal,
  stepsFor,
  wonReadiness,
  type ClosingOutcome,
  type ClosingStep,
  type SplitRow,
} from "./kapanis-model";

const COMMISSION_STATUS_LABELS: Record<string, string> = {
  pending: "Bekliyor",
  calculated: "Hesaplandı",
  approved: "Onaylandı",
  paid: "Ödendi",
  collected: "Tahsil edildi",
  cancelled: "İptal edildi",
  canceled: "İptal edildi",
};

function commissionStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return COMMISSION_STATUS_LABELS[status.toLowerCase()] ?? status;
}

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
  // Aşağıdakiler KapanisPanel (sunucu) tarafından doldurulur.
  commissionRate?: number | null;
  /** Ofis Tanımları Merkezi: pay kaydedilmemiş anlaşmada önerilen danışman payı (varsayılan 50). */
  defaultAdvisorShare?: number;
  commission?: { id: string; gross: number; vat: number; status: string; splits: { label: string; rate: number }[] } | null;
  checklist?: { done: number; total: number };
  hasCollectionTask?: boolean;
  defaultDue?: string;
};

const money = (n: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";

/**
 * Anlaşma kapanış sihirbazı — detay sayfasında sekme (popup DEĞİL). Adımlar gerçek veriden
 * türer; aşama geçişi `updateDealStage`, tutar `updateDeal`, paylar `updateCommissionSplits`,
 * görev `createTask`, anket `createSurveyForDeal` ile yapılır (kopya iş mantığı yok).
 */
export function KapanisSihirbazi(props: KapanisProps) {
  const router = useRouter();
  // Pano bir kartı Kazanıldı/Kaybedildi'ye bıraktığında buraya `?sonuc=` ile gelinir: ilgili akış
  // seçili açılır. Aşama burada DEĞİŞMEZ; yalnız "… olarak kapat" düğmesi updateDealStage'i çağırır.
  const startOutcome = initialOutcome(props.stage, props.requestedOutcome);
  const [outcome, setOutcome] = useState<ClosingOutcome | null>(startOutcome);
  const [step, setStep] = useState<ClosingStep>(initialStep(startOutcome, props.stage));
  const [taskCreated, setTaskCreated] = useState(false);

  if (props.stage !== "won" && props.stage !== "lost" && outcome === null) {
    return (
      <section className="surface-card rounded-[var(--radius-panel)] p-5">
        <h2 className="font-display font-bold text-ink-950">Anlaşmayı kapatın</h2>
        <p className="mt-0.5 text-sm text-text-muted">Sonucu seçin; sihirbaz her adımda ne yapılacağını söyler.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            icon={<Trophy className="h-5 w-5" aria-hidden />}
            title="Kazanıldı"
            text="Nihai tutar, komisyon payları, tahsilat vadesi, belgeler ve memnuniyet anketi."
            tone="mint"
            onClick={() => {
              setOutcome("won");
              setStep("tutar");
            }}
          />
          <ChoiceCard
            icon={<ThumbsDown className="h-5 w-5" aria-hidden />}
            title="Kaybedildi"
            text="Kayıp nedeni, rakip/fiyat notu ve geri kazanım için takip görevi."
            tone="neutral"
            onClick={() => {
              setOutcome("lost");
              setStep("neden");
            }}
          />
        </div>
      </section>
    );
  }

  const activeOutcome = outcome ?? "won";
  const steps = stepsFor(activeOutcome);
  const index = steps.findIndex((s) => s.id === step);
  const prev = index > 0 ? steps[index - 1].id : null;
  const next = index >= 0 && index < steps.length - 1 ? steps[index + 1].id : null;
  const unlocked = (id: ClosingStep) => isStepUnlocked(activeOutcome, id, props.stage);

  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display font-bold text-ink-950">
          {activeOutcome === "won" ? "Kazanıldı: kapanış sihirbazı" : "Kaybedildi: kapanış sihirbazı"}
        </h2>
        {props.stage !== "won" && props.stage !== "lost" ? (
          <button
            type="button"
            className="focus-ring text-xs font-semibold text-text-muted hover:text-text"
            onClick={() => setOutcome(null)}
          >
            Sonucu değiştir
          </button>
        ) : null}
      </div>

      <ol className="mt-4 flex gap-1 overflow-x-auto pb-1" aria-label="Kapanış adımları">
        {steps.map((s, i) => {
          const isCurrent = s.id === step;
          const locked = !unlocked(s.id);
          return (
            <li key={s.id} className="shrink-0">
              <button
                type="button"
                disabled={locked}
                aria-current={isCurrent ? "step" : undefined}
                onClick={() => setStep(s.id)}
                className={
                  "focus-ring flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed " +
                  (isCurrent ? "bg-accent text-white" : locked ? "bg-line text-text-faint" : "bg-line text-text-muted hover:text-text")
                }
              >
                <span aria-hidden>{locked ? <Lock className="h-3 w-3" /> : i + 1}</span>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-5 space-y-4">
        {activeOutcome === "won" ? (
          <WonBody {...props} step={step} go={setStep} />
        ) : (
          <LostBody {...props} step={step} go={setStep} taskCreated={taskCreated} onTask={() => setTaskCreated(true)} />
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <div>
          {prev && unlocked(prev) ? (
            <Button type="button" variant="ghost" icon={ArrowLeft} onClick={() => setStep(prev)}>
              Geri
            </Button>
          ) : null}
        </div>
        {next && unlocked(next) ? (
          <Button
            type="button"
            variant="secondary"
            iconRight={ArrowRight}
            onClick={() => {
              setStep(next);
              router.refresh();
            }}
          >
            {step === "belgeler" || step === "vade" || step === "anket" || step === "takip" ? "Atla / ileri" : "İleri"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function ChoiceCard({
  icon,
  title,
  text,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  tone: "mint" | "neutral";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring press flex gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-left transition hover:border-brand-300"
    >
      <span
        className={
          "grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] " +
          (tone === "mint" ? "bg-mint-500/12 text-mint-600" : "bg-line text-text-muted")
        }
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-text">{title}</span>
        <span className="mt-0.5 block text-xs text-text-muted">{text}</span>
      </span>
    </button>
  );
}

type BodyProps = KapanisProps & { step: ClosingStep; go: (s: ClosingStep) => void };

// ---------------------------------------------------------------- Kazanıldı

function WonBody(p: BodyProps) {
  switch (p.step) {
    case "tutar":
      return <ValueStep {...p} />;
    case "onay":
      return <ConfirmStep {...p} />;
    case "paylar":
      return <SplitsStep {...p} />;
    case "vade":
      return <DueStep {...p} />;
    case "belgeler":
      return <DocsStep {...p} />;
    case "anket":
      return <SurveyStep {...p} />;
    default:
      return <WonFinish {...p} />;
  }
}

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  return { router, pending, startTransition, error, setError, info, setInfo };
}

function ValueStep(p: BodyProps) {
  const r = useRun();
  const [value, setValue] = useState(p.dealValue != null ? String(p.dealValue) : "");
  const num = Number(value.replace(/\./g, "").replace(",", "."));
  const preview =
    p.showMoney && p.commissionRate && num > 0 ? calculateCommission({ amount: num, rate: p.commissionRate }) : null;

  function save() {
    r.setError(null);
    r.setInfo(null);
    const fd = new FormData();
    fd.set("deal_id", p.dealId);
    fd.set("deal_value", value);
    r.startTransition(async () => {
      const res = await updateDeal(fd);
      if (res.error) return r.setError(res.error);
      r.setInfo("Tutar kaydedildi.");
      r.router.refresh();
      p.go("onay");
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        Pazarlık sonunda anlaşılan <strong className="text-text">nihai tutarı</strong> girin. Komisyon bu tutardan hesaplanır.
      </p>
      <div className="max-w-xs">
        <label htmlFor="kap-tutar" className="mb-1 block text-xs font-semibold text-text-muted">
          Nihai tutar (₺)
        </label>
        <FormInput id="kap-tutar" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} disabled={!p.canEdit} />
      </div>
      {p.showMoney ? (
        p.commissionRate ? (
          preview ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <Stat label={`Komisyon (%${p.commissionRate}, KDV hariç)`} value={money(preview.net)} />
              <Stat label="KDV (%20)" value={money(preview.vat)} />
              <Stat label={`Danışman payı (varsayılan %${preview.used.advisorShare})`} value={money(preview.advisorGross)} />
            </dl>
          ) : (
            <p className="text-xs text-text-muted">Tutarı girince komisyon önizlemesi görünür.</p>
          )
        ) : (
          <Alert tone="warning">
            Portföyde komisyon oranı tanımlı değil; kazanmadan önce tanımlayın.
            {p.propertyId ? (
              <>
                {" "}
                <Link className="font-semibold underline" href={`/app/portfoyler/${p.propertyId}`}>
                  Portföye git
                </Link>
              </>
            ) : null}
          </Alert>
        )
      ) : null}
      {r.error ? <Alert tone="danger">{r.error}</Alert> : null}
      {r.info ? <Alert tone="success">{r.info}</Alert> : null}
      {p.canEdit ? (
        <Button type="button" loading={r.pending} disabled={!(num > 0)} onClick={save}>
          Tutarı kaydet
        </Button>
      ) : (
        <p className="text-xs text-text-muted">Tutarı düzenlemek için anlaşma düzenleme yetkisi gerekir.</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-2.5">
      <dt className="text-xs text-text-faint">{label}</dt>
      <dd className="numeric text-sm font-bold text-ink-950">{value}</dd>
    </div>
  );
}

function ConfirmStep(p: BodyProps) {
  const r = useRun();
  const items = wonReadiness(
    {
      dealType: p.dealType,
      hasProperty: Boolean(p.propertyId),
      hasCustomer: Boolean(p.customerId),
      dealValue: p.dealValue,
      commissionRate: p.commissionRate ?? null,
    },
    { dealId: p.dealId, propertyId: p.propertyId },
  );
  // Oran yalnız para görünürken yüklenmiş sayılır; görünmüyorsa sunucu son kararı verir.
  const ready = isReadyToWin(p.showMoney ? items : items.filter((i) => i.key !== "rate"));

  if (p.stage === "won") {
    return (
      <Alert tone="success" title="Anlaşma kazanıldı olarak kapatıldı">
        Komisyon kaydı otomatik oluştu. Sonraki adımda payları ayarlayın.
      </Alert>
    );
  }

  function win() {
    r.setError(null);
    const fd = new FormData();
    fd.set("deal_id", p.dealId);
    fd.set("stage", "won");
    r.startTransition(async () => {
      const res = await updateDealStage(fd);
      if (res.error) return r.setError(res.error);
      r.router.refresh();
      p.go("paylar");
    });
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
        {items
          .filter((i) => p.showMoney || i.key !== "rate")
          .map((i) => (
            <li key={i.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span
                className={"grid h-5 w-5 shrink-0 place-items-center rounded-full " + (i.ok ? "bg-mint-500 text-white" : "bg-line text-text-faint")}
                aria-hidden
              >
                {i.ok ? <Check className="h-3 w-3" /> : null}
              </span>
              <span className="min-w-0 flex-1 text-text">{i.label}</span>
              {!i.ok && i.href ? (
                <Link href={i.href} className="focus-ring text-xs font-semibold text-brand-600 hover:underline">
                  Düzelt
                </Link>
              ) : null}
            </li>
          ))}
      </ul>
      {r.error ? <Alert tone="danger">{r.error}</Alert> : null}
      {p.canCreate && p.canEdit ? (
        <Button type="button" icon={Trophy} loading={r.pending} disabled={!ready} onClick={win}>
          Kazanıldı olarak kapat
        </Button>
      ) : (
        <p className="text-xs text-text-muted">Kazanmak için komisyon oluşturma yetkisi gerekir.</p>
      )}
      <p className="text-xs text-text-faint">Portföy satıldı olarak işaretlenir ve komisyon kaydı otomatik oluşur. Geri almak için komisyon silme yetkisi gerekir.</p>
    </div>
  );
}

function SplitsStep(p: BodyProps) {
  const r = useRun();
  const initial: SplitRow[] =
    p.commission && p.commission.splits.length > 0
      ? p.commission.splits.map((s) => ({ label: s.label, rate: String(s.rate) }))
      : [
          { label: "Danışman", rate: String(p.defaultAdvisorShare ?? 50) },
          { label: "Ofis", rate: String(Math.round((100 - (p.defaultAdvisorShare ?? 50)) * 100) / 100) },
        ];
  const [rows, setRows] = useState<SplitRow[]>(initial);

  if (!p.showMoney) {
    return <Alert tone="info">Komisyon payları yalnız ilgili danışman ve kazanç görme yetkisi olanlara görünür.</Alert>;
  }
  if (!p.commission) {
    return <Alert tone="warning">Komisyon kaydı bulunamadı. Önce anlaşmayı kazanıldı olarak kapatın.</Alert>;
  }
  const commission = p.commission;
  const total = splitsTotal(rows);
  const err = splitsError(rows);
  const set = (i: number, patch: Partial<SplitRow>) => setRows((rs) => rs.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  function save() {
    r.setError(null);
    r.setInfo(null);
    r.startTransition(async () => {
      const res = await updateCommissionSplits(
        commission.id,
        rows.map((x) => ({ label: x.label, rate: Number(x.rate) || 0 })),
      );
      if (res.error) return r.setError(res.error);
      r.setInfo("Paylar kaydedildi.");
      r.router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <dl className="grid gap-2 sm:grid-cols-3">
        <Stat label="Komisyon (KDV hariç)" value={money(commission.gross)} />
        <Stat label="KDV" value={money(commission.vat)} />
        <Stat label="Durum" value={commissionStatusLabel(commission.status)} />
      </dl>
      <p className="text-sm text-text-muted">Komisyonu taraflar arasında oranla bölüştürün (danışman payı dahil).</p>
      <div className="space-y-2">
        {rows.map((x, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              aria-label={`Pay ${i + 1} taraf`}
              value={x.label}
              onChange={(e) => set(i, { label: e.target.value })}
              placeholder="Taraf (Danışman, Ofis, Referans)"
              className={fieldClass + " min-w-0 flex-1"}
            />
            <div className="relative w-24 shrink-0">
              <input
                aria-label={`Pay ${i + 1} oran`}
                type="number"
                min="0"
                max="100"
                step="1"
                value={x.rate}
                onChange={(e) => set(i, { rate: e.target.value })}
                className={fieldClass + " pr-6"}
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-faint">%</span>
            </div>
            <span className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums text-ink-950">
              {money(Math.round(commission.gross * ((Number(x.rate) || 0) / 100)))}
            </span>
            <button
              type="button"
              aria-label="Satırı sil"
              className="focus-ring rounded p-1 text-text-faint hover:text-danger-500"
              onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
              disabled={rows.length <= 1}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" icon={Plus} onClick={() => setRows((rs) => [...rs, { label: "", rate: "" }])}>
          Pay ekle
        </Button>
        <p className={"text-xs font-semibold " + (total > 100.01 ? "text-danger-500" : total === 100 ? "text-mint-600" : "text-text-muted")}>
          Toplam %{total} {total < 100 ? `(kalan %${Math.round((100 - total) * 100) / 100})` : ""}
        </p>
      </div>
      {r.error ? <Alert tone="danger">{r.error}</Alert> : null}
      {r.info ? <Alert tone="success">{r.info}</Alert> : null}
      <Button type="button" loading={r.pending} disabled={Boolean(err) || !p.canEdit} onClick={save}>
        Payları kaydet
      </Button>
      {err && rows.some((x) => x.label || x.rate) ? <p className="text-xs text-danger-500">{err}</p> : null}
    </div>
  );
}

function DueStep(p: BodyProps) {
  const r = useRun();
  const [due, setDue] = useState(p.defaultDue ?? "");
  const [created, setCreated] = useState(Boolean(p.hasCollectionTask));
  const name = p.customerName ?? "müşteri";

  function create() {
    r.setError(null);
    const fd = new FormData();
    fd.set("title", `${COLLECTION_TASK_PREFIX}: ${p.propertyTitle ?? "anlaşma"} (${name})`);
    fd.set("kind", "followup");
    fd.set("priority", "high");
    fd.set("due_at", due);
    fd.set("deal_id", p.dealId);
    if (p.customerId) fd.set("customer_id", p.customerId);
    if (p.propertyId) fd.set("property_id", p.propertyId);
    r.startTransition(async () => {
      const res = await createTask({}, fd);
      if (res.error) return r.setError(res.error);
      setCreated(true);
      r.router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        Komisyonun tahsil edileceği <strong className="text-text">vadeyi</strong> belirleyin; bu tarihte sizi hatırlatacak bir görev açılır.
        Tahsilatı işaretlemek için Komisyon merkezini kullanın.
      </p>
      {created ? (
        <Alert tone="success">Tahsilat görevi açık. Görevler sekmesinden izleyebilirsiniz.</Alert>
      ) : p.canCreateTask ? (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="kap-vade" className="mb-1 block text-xs font-semibold text-text-muted">
              Vade
            </label>
            <FormInput id="kap-vade" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <Button type="button" loading={r.pending} disabled={!due} onClick={create}>
            Tahsilat görevi oluştur
          </Button>
        </div>
      ) : (
        <p className="text-xs text-text-muted">Görev oluşturma yetkiniz yok; bu adımı atlayabilirsiniz.</p>
      )}
      {r.error ? <Alert tone="danger">{r.error}</Alert> : null}
    </div>
  );
}

function DocsStep(p: BodyProps) {
  const c = p.checklist ?? { done: 0, total: 0 };
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        Tapu, vekaletname, kimlik ve sözleşme gibi kapanış evrakları anlaşmanın evrak dosyasında takip edilir.
      </p>
      <p className="text-sm text-text">
        {c.total > 0 ? (
          <>
            Evrak dosyası: <strong>{c.done}</strong> / {c.total} tamam
          </>
        ) : (
          "Evrak listesi henüz oluşturulmadı."
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/app/anlasmalar/${p.dealId}?sekme=belgeler`} variant="secondary" iconRight={ArrowRight}>
          Evrak dosyasını aç
        </ButtonLink>
        <ButtonLink href="/app/sozlesmeler" variant="ghost">
          Sözleşmeler
        </ButtonLink>
      </div>
    </div>
  );
}

function SurveyStep(p: BodyProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        Müşteriye tek soruluk memnuniyet anketi gönderin. SMS gönderilmez; linki siz iletirsiniz.
      </p>
      {p.survey ? (
        p.survey.answered ? (
          <p className="text-sm text-text">
            Müşteri yanıtladı: <strong className="numeric">{p.survey.score}</strong> / 10
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-brand-600/10 px-2.5 py-0.5 text-xs font-bold text-brand-600">Yanıt bekliyor</span>
            <CopySurveyLinkButton url={p.survey.url} />
          </div>
        )
      ) : !p.customerId ? (
        <Alert tone="warning">Anlaşmaya müşteri bağlı değil; anket gönderilecek kişi belirsiz.</Alert>
      ) : p.canSurvey ? (
        <CreateSurveyButton dealId={p.dealId} />
      ) : (
        <p className="text-xs text-text-muted">Anket üretmek için rapor yetkisi gerekiyor.</p>
      )}
    </div>
  );
}

function WonFinish(p: BodyProps) {
  const c = p.commission;
  const share = advisorShareOf(c?.splits);
  const c2 = p.checklist ?? { done: 0, total: 0 };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        {p.stage === "won" ? <Celebrate label="Anlaşma kazanıldı" /> : null}
        <div>
          <h3 className="font-display text-lg font-bold text-text">
            {p.stage === "won" ? "Tebrikler, anlaşma kapandı" : "Anlaşma henüz kapanmadı"}
          </h3>
          <p className="text-sm text-text-muted">
            {p.stage === "won"
              ? `${p.propertyTitle ?? "Portföy"} · ${p.customerName ?? "Müşteri"}`
              : "Kazanıldı adımını tamamlayınca özet burada görünür."}
          </p>
        </div>
      </div>
      {p.stage === "won" ? (
        <dl className="grid gap-2 sm:grid-cols-2">
          <Stat label="Nihai tutar" value={p.dealValue != null ? money(p.dealValue) : "—"} />
          {p.showMoney && c ? <Stat label="Komisyon (KDV hariç)" value={money(c.gross)} /> : null}
          {p.showMoney && c && share != null ? <Stat label={`Danışman payı (%${share})`} value={money((c.gross * share) / 100)} /> : null}
          <Stat label="Evrak dosyası" value={c2.total ? `${c2.done} / ${c2.total}` : "—"} />
          <Stat label="Memnuniyet anketi" value={p.survey ? (p.survey.answered ? `${p.survey.score} / 10` : "Yanıt bekliyor") : "Gönderilmedi"} />
        </dl>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {p.showMoney ? (
          <ButtonLink href="/app/komisyon" variant="secondary">
            Komisyon merkezi
          </ButtonLink>
        ) : null}
        <ButtonLink href="/app/anlasmalar">Anlaşmalara dön</ButtonLink>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Kaybedildi

function LostBody(p: BodyProps & { taskCreated: boolean; onTask: () => void }) {
  if (p.step === "neden") return <LostReasonStep {...p} />;
  if (p.step === "takip") return <FollowUpStep {...p} />;
  return <LostFinish {...p} />;
}

function LostReasonStep(p: BodyProps) {
  const r = useRun();
  const [reason, setReason] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [price, setPrice] = useState("");
  const [extra, setExtra] = useState("");

  if (p.stage === "lost") {
    return (
      <Alert tone="info" title="Anlaşma kaybedildi olarak kapatıldı">
        {p.lossReasonText ? `Kayıt: ${p.lossReasonText}` : "Kayıp nedeni kayıtlı değil."}
      </Alert>
    );
  }

  function submit() {
    r.setError(null);
    const fd = new FormData();
    fd.set("deal_id", p.dealId);
    fd.set("stage", "lost");
    fd.set("loss_reason", reason);
    fd.set("loss_note", buildLossNote(competitor, price, extra));
    r.startTransition(async () => {
      const res = await updateDealStage(fd);
      if (res.error) return r.setError(res.error);
      r.router.refresh();
      p.go("takip");
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">Kaybın nedenini kaydedin; raporlar ve kayıp-satış analizi bu bilgiyle çalışır.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="kap-neden" className="mb-1 block text-xs font-semibold text-text-muted">
            Kayıp nedeni
          </label>
          <FormSelect id="kap-neden" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Seçin</option>
            {p.lossOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </FormSelect>
        </div>
        <div>
          <label htmlFor="kap-rakip" className="mb-1 block text-xs font-semibold text-text-muted">
            Rakip (isteğe bağlı)
          </label>
          <FormInput id="kap-rakip" value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder="Hangi ofis/kişi aldı?" />
        </div>
        <div>
          <label htmlFor="kap-fiyat" className="mb-1 block text-xs font-semibold text-text-muted">
            Fiyat notu (isteğe bağlı)
          </label>
          <FormInput id="kap-fiyat" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Ör. %5 daha ucuz teklif aldı" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="kap-not" className="mb-1 block text-xs font-semibold text-text-muted">
            Ek açıklama {reason === "diger" ? "(zorunlu)" : "(isteğe bağlı)"}
          </label>
          <FormTextarea id="kap-not" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} />
        </div>
      </div>
      {r.error ? <Alert tone="danger">{r.error}</Alert> : null}
      {p.canEdit ? (
        <Button type="button" variant="danger" loading={r.pending} disabled={!reason} onClick={submit}>
          Kaybedildi olarak kapat
        </Button>
      ) : (
        <p className="text-xs text-text-muted">Anlaşmayı kapatmak için düzenleme yetkisi gerekir.</p>
      )}
    </div>
  );
}

function FollowUpStep(p: BodyProps & { taskCreated: boolean; onTask: () => void }) {
  const r = useRun();
  const [title, setTitle] = useState(`Geri kazanım: ${p.customerName ?? "müşteri"} ile yeniden görüş`);
  const [due, setDue] = useState(p.defaultDue ?? "");

  function create() {
    r.setError(null);
    const fd = new FormData();
    fd.set("title", title);
    fd.set("kind", "followup");
    fd.set("due_at", due);
    fd.set("deal_id", p.dealId);
    if (p.customerId) fd.set("customer_id", p.customerId);
    if (p.propertyId) fd.set("property_id", p.propertyId);
    r.startTransition(async () => {
      const res = await createTask({}, fd);
      if (res.error) return r.setError(res.error);
      p.onTask();
      r.router.refresh();
      p.go("bitis");
    });
  }

  if (p.taskCreated) return <Alert tone="success">Takip görevi oluşturuldu.</Alert>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">Kayıp müşteriyi unutmayın: ileri bir tarihe takip görevi ekleyin ya da bu adımı atlayın.</p>
      {p.canCreateTask ? (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <label htmlFor="kap-gorev" className="mb-1 block text-xs font-semibold text-text-muted">
                Görev
              </label>
              <FormInput id="kap-gorev" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label htmlFor="kap-gorev-tarih" className="mb-1 block text-xs font-semibold text-text-muted">
                Tarih
              </label>
              <FormInput id="kap-gorev-tarih" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>
          {r.error ? <Alert tone="danger">{r.error}</Alert> : null}
          <Button type="button" loading={r.pending} disabled={!title.trim()} onClick={create}>
            Takip görevi oluştur
          </Button>
        </>
      ) : (
        <p className="text-xs text-text-muted">Görev oluşturma yetkiniz yok; bu adımı atlayabilirsiniz.</p>
      )}
    </div>
  );
}

function LostFinish(p: BodyProps & { taskCreated: boolean }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        {p.stage === "lost" ? <Celebrate tone="neutral" label="Kayıt tamamlandı" /> : null}
        <div>
          <h3 className="font-display text-lg font-bold text-text">
            {p.stage === "lost" ? "Kayıp kaydedildi" : "Anlaşma henüz kapanmadı"}
          </h3>
          <p className="text-sm text-text-muted">
            {p.stage === "lost"
              ? `${p.lossReasonText ?? "Kayıp nedeni kayıtlı değil"}${p.taskCreated ? " · Takip görevi açıldı" : ""}`
              : "Kayıp nedenini kaydedince özet burada görünür."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/app/kayip-satis" variant="secondary">
          Kayıp satış analizi
        </ButtonLink>
        <ButtonLink href="/app/anlasmalar">Anlaşmalara dön</ButtonLink>
      </div>
    </div>
  );
}
