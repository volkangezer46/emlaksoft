"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { Ban, Check, CheckCheck, Coins, Loader2, MoreVertical, Plus, Undo2, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { createDue, toggleDuePaid, markDuesPaidBulk, type DueResult } from "@/app/actions/dues";
import { useToast } from "@/components/app/toast-provider";
import { trDayKey } from "@/lib/clock";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Combobox } from "@/components/ui/combobox";
import { searchProperties } from "@/app/actions/lookup";
import { DueEditPanel } from "./due-edit-panel";
import { MoneyInput } from "@/components/ui/money-input";
import { DueCancelDialog } from "./due-cancel-dialog";
import { FinanceAccountPicker } from "@/components/app/finance-account-picker";
import { DUE_DIRECTION_LABELS, isDueOpen, isDueOverdue, type DueView } from "@/lib/finance/dues/dues";

type Property = { id: string; property_code: string; title: string | null };
type Due = DueView;

const init: DueResult = {};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}
function monthLabel(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", month: "long", year: "numeric" }).format(new Date(iso));
}

/** Aidat satırının ikincil eylemi (⋮): iptal (silme yok). İptal penceresi menü kapansa da açık kalır. */
function DueRowMore({ id, title, disabled }: { id: string; title: string; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={`Diğer işlemler: ${title}`}
            title="Diğer işlemler"
            className="focus-ring press grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-transparent text-text-muted transition hover:border-border-interactive hover:bg-surface-hover hover:text-brand-700 disabled:opacity-50 touch:h-11 touch:w-11"
          >
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem danger onSelect={() => setOpen(true)}>
            <Ban aria-hidden="true" /> Aidatı iptal et…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DueCancelDialog dueId={id} title={title} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function DuesClient({
  dues,
  properties,
  canCreate,
  canBulk = false,
  canCancel = false,
  today,
}: {
  dues: Due[];
  properties: Property[];
  canCreate: boolean;
  /** Ödendi işaretleme ve toplu işlem (expenses edit yetkisi) */
  canBulk?: boolean;
  /** İptal (expenses delete yetkisi; silme yok) */
  canCancel?: boolean;
  /** Bugün (YYYY-AA-GG, İstanbul) — gecikme rozeti sunucuyla aynı günden hesaplanır. */
  today: string;
}) {
  const router = useRouter();
  const { push } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(createDue, init);
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  // Ödemenin çıktığı hesap (isteğe bağlı): seçilirse "Ödendi" kasaya çıkış hareketi yazar, seçilmezse kasa dışı kapatır.
  const [accountId, setAccountId] = useState("");
  // Toplu seçim — yalnızca açık (ödenmemiş, iptal edilmemiş) kayıtlar seçilebilir
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const unpaidIds = dues.filter((d) => isDueOpen(d.status)).map((d) => d.id);
  const allSelected = selected.size > 0 && unpaidIds.every((id) => selected.has(id));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkPaid() {
    if (selected.size === 0) return;
    setBusy("bulk");
    try {
      const res = await markDuesPaidBulk(Array.from(selected), accountId || null);
      if (res.error) push(res.error, "err");
      else {
        push(`${res.updated ?? 0} aidat ödendi olarak işaretlendi`, "ok");
        setSelected(new Set());
        router.refresh();
      }
    } catch {
      push("Aidatlar güncellenemedi. Bağlantınızı kontrol edip tekrar deneyin.", "err");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      push("Aidat kaydı oluşturuldu", "ok");
      router.refresh();
    }
  }, [state, router, push]);

  function toggle(id: string, toPaid: boolean) {
    setBusy(id);
    startTransition(async () => {
      try {
        const result = await toggleDuePaid(id, toPaid, toPaid ? accountId || null : null);
        if (result.error) push(result.error, "err");
        else {
          push(toPaid ? "Aidat ödendi olarak işaretlendi" : "Aidat bekleyen duruma alındı", "ok");
          router.refresh();
        }
      } catch {
        push("Aidat durumu güncellenemedi. Lütfen tekrar deneyin.", "err");
      } finally {
        setBusy(null);
      }
    });
  }
  return (
    <div className="space-y-6">
      {canCreate ? (
        <section id="aidat-ekle" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950"><Plus className="h-4 w-4 text-brand-600" /> Yeni aidat kaydı</h2>
          <form ref={formRef} action={action} aria-busy={pending} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs font-semibold text-text-muted">
              Başlık
              <input name="title" required maxLength={160} placeholder="Örn. Nisan aidatı" className="mt-1 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm font-normal text-ink-950 outline-none focus:border-brand-400" />
            </label>
            <label className="block text-xs font-semibold text-text-muted">
              Tutar (₺)
              <MoneyInput name="amount" required bare placeholder="1.250,00" className="mt-1 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm font-normal text-ink-950 outline-none focus:border-brand-400" />
            </label>
            {/* Bu iki tarih alanının TEK etiketi `title` idi. Native `title`
                ekran okuyucularda güvenilir okunmaz ve görsel olarak da hiçbir
                şey göstermez: kullanıcı iki boş tarih kutusu görüyordu.
                Gerçek <label> ile değiştirildi. */}
            <label className="block text-xs font-semibold text-text-muted">
              İlgili ay
              <input name="period" type="date" defaultValue={trDayKey()} className="mt-1 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400" />
            </label>
            <label className="block text-xs font-semibold text-text-muted">
              Son ödeme tarihi
              <input name="due_date" type="date" className="mt-1 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400" />
            </label>
            <label className="block text-xs font-semibold text-text-muted">
              Kim öder?
              <select name="direction" defaultValue="payable" className="mt-1 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm font-normal text-ink-950 outline-none focus:border-brand-400">
                <option value="payable">{DUE_DIRECTION_LABELS.payable} (gider / borç)</option>
                <option value="receivable">{DUE_DIRECTION_LABELS.receivable} (alacak)</option>
              </select>
            </label>
            <div className="sm:col-span-2 lg:col-span-2">
              <Combobox
                name="property_id"
                aria-label="Portföy"
                placeholder="Portföy (opsiyonel)"
                searchPlaceholder="Kod ya da başlık ara…"
                emptyText="Eşleşen portföy yok"
                onSearch={searchProperties}
                options={properties.map((p) => ({
                  value: p.id,
                  label: p.title ?? p.property_code,
                  hint: p.title ? p.property_code : undefined,
                }))}
              />
            </div>
            <button type="submit" disabled={pending} className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ekle
            </button>
          </form>
          {state.error ? <p role="alert" className="mt-2 text-sm text-danger-500">{state.error}</p> : null}
        </section>
      ) : null}

      {dues.length === 0 ? (
        <EmptyState illustration="komisyon"
          icon={Coins}
          title="Henüz aidat kaydı yok"
          description="Portföy bazlı aidat ve ortak gider kayıtlarınız burada listelenecek. Yukarıdan ilk kaydı ekleyin."
          tone="amber"
          action={canCreate ? { href: "#aidat-ekle", label: "İlk aidatı ekle" } : { href: "/app/portfoyler", label: "Portföylere git" }}
        />
      ) : (
        <>
        {/* Toplu işlem çubuğu — seçim varken görünür */}
        {canBulk && unpaidIds.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-2.5 shadow-[var(--shadow-xs)]">
            <FinanceAccountPicker direction="out" value={accountId} onChange={setAccountId} />
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-text-muted">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(unpaidIds))}
                aria-label="Bekleyen tüm aidatları seç"
                className="focus-ring h-4 w-4 cursor-pointer rounded border-line accent-[var(--brand-600)]"
              />
              Tümünü seç
            </label>
            {selected.size > 0 ? (
              <>
                <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600">
                  {selected.size} seçili
                </span>
                <button
                  type="button"
                  onClick={bulkPaid}
                  disabled={busy === "bulk"}
                  className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-mint-500/15 px-3 py-1.5 text-xs font-bold text-mint-700 transition hover:bg-mint-500/25 disabled:opacity-50"
                >
                  {busy === "bulk" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                  Seçilenleri ödendi işaretle
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  disabled={busy === "bulk"}
                  className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] px-2 py-1.5 text-xs font-semibold text-text-muted transition hover:text-danger-500 disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" /> Seçimi bırak
                </button>
              </>
            ) : (
              <span className="text-xs text-text-faint">Bekleyen kayıtları işaretleyip topluca ödendi yapın</span>
            )}
          </div>
        ) : null}
        <TableFrame minWidth={720} stack>
          <Table>
            <THead>
              <TR>
                {canBulk ? <TH><span className="sr-only">Seç</span></TH> : null}
                <TH>Başlık</TH>
                <TH className="hidden sm:table-cell">Portföy</TH>
                <TH className="hidden sm:table-cell">Dönem</TH>
                <TH align="right">Tutar</TH>
                <TH>Durum</TH>
                <TH align="right"><span className="sr-only">İşlem</span></TH>
              </TR>
            </THead>
            <TBody>
                {dues.map((d) => {
                  const prop = d.property;
                  const paid = d.status === "paid";
                  const cancelled = d.status === "cancelled";
                  const open = isDueOpen(d.status);
                  const overdue = isDueOverdue(d, today);
                  return (
                    /* Satırın tamamı ilgili portföye tıklanabilir — diğer liste
                       sayfalarıyla tutarlı. Aidatın kendi detay sayfası yok,
                       bağlamsal olarak doğru hedef portföy. */
                    <TR key={d.id} interactive={Boolean(prop)}>
                      {canBulk ? (
                        <TD>
                          {/* relative + z-10: satır örtü linkinin üstünde kalsın */}
                          {open ? (
                            <input
                              type="checkbox"
                              checked={selected.has(d.id)}
                              onChange={() => toggleSelect(d.id)}
                              aria-label={`${d.title} kaydını seç`}
                              className="focus-ring relative z-10 h-4 w-4 cursor-pointer rounded border-line accent-[var(--brand-600)]"
                            />
                          ) : (
                            <span className="inline-block h-4 w-4" aria-hidden />
                          )}
                        </TD>
                      ) : null}
                      <TD primary className="font-semibold text-ink-950">
                        {/* Overlay yalnız sm+ (mobilde abs katman iOS'ta tabloyu belge
                            scroll'una promote edip sayfayı yana kaydırıyor). Mobilde
                            tıklama için başlık Link. */}
                        {prop ? (
                          <>
                            <Link
                              href={`/app/portfoyler/${prop.id}`}
                              className="absolute inset-0 hidden sm:block"
                              aria-label={`${d.title} — ${prop.title ?? prop.property_code} portföyünü aç`}
                            />
                            <Link href={`/app/portfoyler/${prop.id}`} className="sm:pointer-events-none">
                              {d.title}
                            </Link>
                          </>
                        ) : (
                          d.title
                        )}
                      </TD>
                      <TD label="Portföy" className="hidden text-text-muted sm:table-cell">
                        {prop ? (prop.title ?? prop.property_code) : "—"}
                      </TD>
                      <TD label="Dönem" className="hidden text-text-muted sm:table-cell">{monthLabel(d.period)}</TD>
                      <TD label="Tutar" align="right" className={cancelled ? "text-text-faint line-through" : "font-bold text-ink-950"}>
                        {money(d.amount)}
                        {d.status === "partial" ? <span className="block text-xs font-normal text-text-muted">kalan {money(d.remaining)}</span> : null}
                      </TD>
                      <TD>
                        <Badge variant={paid ? "success" : cancelled ? "neutral" : overdue ? "danger" : "warning"} size="sm">
                          {paid ? "Ödendi" : cancelled ? "İptal" : overdue ? "Gecikti" : d.status === "partial" ? "Kısmi" : "Bekliyor"}
                        </Badge>
                        {d.direction === "receivable" ? <span className="mt-0.5 block text-xs text-text-muted">{DUE_DIRECTION_LABELS.receivable}</span> : null}
                        {cancelled && d.cancelReason ? <span className="mt-0.5 block text-xs text-text-muted">Neden: {d.cancelReason}</span> : null}
                      </TD>
                      <TD actions align="right">
                        {/* relative + z-10: satır linkinin üstünde kalsın; mobilde de görünür */}
                        <div className="relative z-10 flex items-center justify-end gap-1.5">
                          {canBulk && open ? (
                            <DueEditPanel
                              due={{ id: d.id, title: d.title, amount: d.amount, period: d.period, due_date: d.dueDate, notes: d.notes }}
                            />
                          ) : null}
                          {canBulk && !cancelled ? (
                            <button type="button" onClick={() => toggle(d.id, !paid)} disabled={busy === d.id}
                              title={paid ? "Kasa dışı kapatılmış ödemeyi geri alır" : accountId ? "Seçilen hesaptan çıkış hareketi yazılır" : "Hesap seçilmedi: kasa dışı ödendi olarak kapatılır"}
                              className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-hairline bg-surface px-2 py-1 text-xs font-semibold text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas disabled:opacity-50">
                              {busy === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : paid ? <Undo2 className="h-3 w-3" /> : <Check className="h-3 w-3 text-mint-600" />}
                              {paid ? "Geri al" : "Ödendi"}
                            </button>
                          ) : null}
                          {canCancel && open ? <DueRowMore id={d.id} title={d.title} disabled={busy === d.id} /> : null}
                        </div>
                      </TD>
                    </TR>
                  );
                })}
            </TBody>
          </Table>
        </TableFrame>
        </>
      )}
    </div>
  );
}
