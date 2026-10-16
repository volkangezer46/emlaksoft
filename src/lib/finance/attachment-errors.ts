import { actionErrorMessage } from "@/lib/action-errors";
import { financeOutcomeMessage } from "@/lib/finance/cash/input";
import { isMissingCashSchema } from "@/lib/finance/cash/load";

/**
 * Finans > Belgeler (FN5) hata metinleri — TEK KAYNAK. Yükleme ucu (`/api/app/finans/belge`) ve ek action'ları
 * (`src/app/actions/expense-receipts.ts`) aynı çeviriyi kullanır. RPC sözleşmesi FN1 ile aynıdır:
 * `FN:<kod>` (P0001, `finance_v2_raise`) → Türkçe mesaj; ay kilidi tetiği `DONEM_KILITLI` → kilit mesajı.
 * Metinler FN1 `src/app/actions/finance-ledger.ts` (`ledgerErrorMessage`) ile birebir aynıdır; FN1 birleşince o dosya
 * da bu modülü kullanabilir (birleştirme notu).
 */

export const FINANCE_LEDGER_NOT_READY = "Muhasebe güncellemesi veritabanına henüz uygulanmamış. Kısa süre sonra yeniden deneyin.";
export const FINANCE_PERIOD_LOCKED =
  "Bu ay kapatılmış (ay kilidi). Kayıt eklemek, değiştirmek ya da iptal etmek için önce Ayarlar > Dönem kapanışı bölümünden kilidi açın.";

const ATTACHMENT_FN_MESSAGES: Record<string, string> = {
  not_found: "Belge ya da bağlanacak kayıt bulunamadı. Sayfayı yenileyip tekrar deneyin.",
  duplicate: "Bu belge zaten kayıtlı.",
  invalid_input: "Belge bilgileri geçersiz (dosya adı, tür ya da boyut).",
  forbidden: "Bu işlem için muhasebe yetkiniz yok.",
};

type RpcError = { code?: string | null; message?: string | null } | null | undefined;

export function isMissingFinanceSchema(error: RpcError): boolean {
  return isMissingCashSchema(error);
}

/** RPC / sorgu hatasını kullanıcı mesajına çevirir. Ham hata metni gösterilmez (actionErrorMessage loglar). */
export function financeAttachmentErrorMessage(error: RpcError, subject: string): string {
  const msg = error?.message ?? "";
  if (msg.includes("DONEM_KILITLI")) return FINANCE_PERIOD_LOCKED;
  const fn = /FN:([a-z_]+)/.exec(msg);
  if (fn) return ATTACHMENT_FN_MESSAGES[fn[1]!] ?? financeOutcomeMessage(fn[1]!);
  if (isMissingFinanceSchema(error)) return FINANCE_LEDGER_NOT_READY;
  if (error?.code === "42501") return ATTACHMENT_FN_MESSAGES.forbidden!;
  return actionErrorMessage(error, subject);
}
