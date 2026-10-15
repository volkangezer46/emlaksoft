import { financeOutcomeMessage } from "@/lib/finance/cash/input";
import { isMissingCashSchema } from "@/lib/finance/cash/load";
import { actionErrorMessage } from "@/lib/action-errors";

/** Aidat / depozito RPC'lerinin (20261017010500) hata sözleşmesi: `FN:<kod>` (finance_v2_raise) ve `DONEM_KILITLI`. */
export const DUE_FN_MESSAGES: Record<string, string> = {
  item_closed: "Bu aidat kapanmış ya da iptal edilmiş.",
  item_not_paid: "Bu aidat ödendi olarak işaretli değil.",
  has_cash: "Bu aidatın ödemesi kasaya işlenmiş. Geri almak için ödeme hareketini Muhasebe > Hareketler'den iptal edin.",
  account_required: "Kısmen ödenmiş ya da hareketi olan aidatı kapatmak için ödemenin çıktığı hesabı seçin.",
  amount_below_paid: "Tutar, ödenmiş kısımdan az olamaz.",
  amount_exceeds_open: "Tutar, aidatın kalan tutarını aşıyor.",
  linked_to_owner: "Bu aidat mülk sahibi hakedişine yansıtılmış. Önce Mülk yönetimi > kira kaydı > Mülk sahibi sekmesinden yansıtmayı geri alın.",
  invalid_input: "Girdiğiniz bilgileri kontrol edin (başlık, tutar, tarih; iptal nedeni en az 3 karakter).",
  forbidden: "Bu işlem için yetkiniz yok.",
  not_found: "Aidat kaydı bulunamadı.",
  no_deposit: "Bu kira kaydında depozito yok.",
  deposit_not_returned: "Önce depozitoyu iade edildi olarak işaretleyin.",
  party_not_found: "Cari bulunamadı.",
};

export const DUE_PERIOD_LOCKED =
  "Bu ay kapatılmış (ay kilidi). Kaydı değiştirmek için kilidi ofis sahibi ya da genel müdür açabilir.";
export const DUE_SCHEMA_MISSING = "Aidat muhasebe güncellemesi veritabanına henüz uygulanmamış. Kısa süre sonra yeniden deneyin.";

type RpcError = { code?: string | null; message?: string | null } | null | undefined;

/** RPC hatasını kullanıcı mesajına çevirir (DONEM_KILITLI, FN:<kod>, şema yok). */
export function dueErrorMessage(error: RpcError, subject: string): string {
  const msg = error?.message ?? "";
  if (msg.includes("DONEM_KILITLI")) return DUE_PERIOD_LOCKED;
  const fn = /FN:([a-z_]+)/.exec(msg);
  if (fn) return DUE_FN_MESSAGES[fn[1]!] ?? financeOutcomeMessage(fn[1]!);
  if (isMissingCashSchema(error ?? null)) return DUE_SCHEMA_MISSING;
  return actionErrorMessage(error ?? null, subject);
}
