import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Settings2, UserCheck } from "lucide-react";
import { APPROVAL_KINDS, kindMeta, type ApprovalPolicy } from "@/lib/approvals";
import type { ApprovalDelegation } from "@/lib/approval-policy";
import type { PersonOption } from "@/components/ui/person-select";
import { DelegateForm } from "./delegate-form";

const nf = (n: number, d = 2) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: d }).format(n);
const dayFmt = (key: string) =>
  new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${key}T12:00:00.000Z`));

/** Otomatik onay kurallarının insanca özeti; hepsi kapalıysa tek ifade. */
function autoSummary(p: ApprovalPolicy): string[] {
  const out: string[] = [];
  if (p.autoMaxCommissionPoints > 0) out.push(`komisyon indirimi ≤ ${nf(p.autoMaxCommissionPoints)} puan`);
  if (p.autoMaxExpenseTry > 0) out.push(`gider ≤ ${nf(p.autoMaxExpenseTry, 0)} ₺`);
  if (p.autoMaxPriceDropPct > 0) out.push(`fiyat indirimi ≤ %${nf(p.autoMaxPriceDropPct, 1)}`);
  return out;
}

/**
 * Onay politikası paneli (OA12): karar süreleri, otomatik onay sınırları ve vekil onaylayıcı tek bakışta. Süre ve
 * sınırlar Kurallar ve varsayılanlar > Onay politikası grubunda düzenlenir (ayar kayıt defteri: doğrulama + geçmiş);
 * vekil burada atanır. Varsayılan kapalı, katlanır: liste ekranını itmez.
 */
export function ApprovalPolicyPanel({
  policy,
  delegation,
  delegationAvailable,
  canEditSettings,
  canManageDelegate,
  people,
  today,
  maxDay,
  viewerIsDelegate,
}: {
  policy: ApprovalPolicy;
  delegation: ApprovalDelegation | null;
  delegationAvailable: boolean;
  canEditSettings: boolean;
  canManageDelegate: boolean;
  people: readonly PersonOption[];
  today: string;
  maxDay: string;
  viewerIsDelegate: boolean;
}) {
  const auto = autoSummary(policy);
  const activeDelegate = delegation?.active ? delegation : null;
  return (
    <>
      {viewerIsDelegate && activeDelegate ? (
        <p role="status" className="flex items-start gap-2 rounded-[var(--radius-card)] border border-brand-400/40 bg-brand-600/6 px-4 py-3 text-sm text-ink-950">
          <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
          <span>
            <strong>{dayFmt(activeDelegate.untilOn)}</strong> tarihine kadar vekil onaylayıcısınız: kendi talepleriniz dışındaki bekleyen
            taleplere karar verebilirsiniz.
          </span>
        </p>
      ) : null}
      <details className="group rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <summary className="focus-ring flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
          <Settings2 className="h-4 w-4 text-text-muted" aria-hidden />
          <span className="text-sm font-semibold text-ink-950">Onay politikası</span>
          <span className="min-w-0 flex-1 text-xs text-text-muted">
            Otomatik onay: {auto.length ? auto.join(" · ") : "kapalı"}
            {" · "}Vekil: {activeDelegate ? `${activeDelegate.delegateName ?? "üye"} (${dayFmt(activeDelegate.untilOn)} tarihine kadar)` : "yok"}
          </span>
          <span className="text-xs font-semibold text-brand-600 group-open:hidden">Göster</span>
          <span className="hidden text-xs font-semibold text-brand-600 group-open:inline">Gizle</span>
        </summary>
        <div className="grid gap-5 border-t border-line px-4 py-4 sm:px-5 lg:grid-cols-2">
          <section aria-labelledby="politika-sure" className="space-y-3">
            <h3 id="politika-sure" className="text-sm font-semibold text-ink-950">Karar süreleri ve otomatik onay</h3>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {APPROVAL_KINDS.map((k) => (
                <li key={k} className="rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2">
                  <p className="text-xs text-text-muted">{kindMeta(k).label}</p>
                  <p className="numeric text-sm font-bold text-ink-950">{policy.slaHours[k]} saat</p>
                </li>
              ))}
            </ul>
            <p className="text-xs text-text-muted">
              {auto.length
                ? `Sınırın altındaki talepler açıldığı anda "Otomatik onay (ofis politikası)" notuyla onaylanır: ${auto.join(", ")}. Ofis kontrolü kuralının açtığı talepler her zaman yönetici bekler.`
                : "Otomatik onay kapalı: her talep yönetici kararı bekler."}
            </p>
            {canEditSettings ? (
              <Link
                href="/app/ayarlar/merkez?grup=onay"
                className="focus-ring inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-600 hover:underline"
              >
                Süreleri ve otomatik onayı düzenle <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ) : null}
          </section>
          <section aria-labelledby="politika-vekil" className="space-y-3">
            <h3 id="politika-vekil" className="text-sm font-semibold text-ink-950">Vekil onaylayıcı</h3>
            <p className="text-xs text-text-muted">
              Siz yokken bekleyen talepler birikmesin: seçtiğiniz üye bitiş tarihine kadar karar verebilir. Kendi talebini onaylayamaz;
              her kararı denetim kaydında &quot;vekil&quot; olarak işaretlenir.
            </p>
            {!delegationAvailable ? (
              <p className="rounded-[var(--radius-card)] border border-dashed border-line px-3 py-2 text-xs text-text-muted">
                Vekil onaylayıcı bu ortamda henüz etkin değil (kurulum bekliyor).
              </p>
            ) : canManageDelegate ? (
              <DelegateForm
                people={people}
                current={delegation ? { delegateId: delegation.delegateId, untilOn: delegation.untilOn, note: delegation.note } : null}
                today={today}
                maxDay={maxDay}
              />
            ) : (
              <p className="text-sm text-ink-950">
                {activeDelegate
                  ? `${activeDelegate.delegateName ?? "Üye"} · ${dayFmt(activeDelegate.untilOn)} tarihine kadar`
                  : "Atanmış vekil yok. Vekili ofis sahibi veya genel müdür atar."}
              </p>
            )}
          </section>
        </div>
      </details>
    </>
  );
}
