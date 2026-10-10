import { formatTry } from "@/lib/format";
import Link from "@/components/ui/smart-link";
import { Gift } from "lucide-react";
import { readTryOverview } from "@/lib/try-credits/reader";
import { readMyDashboard } from "@/lib/growth/engine";
import { createClient } from "@/lib/supabase/server";
import { afterFirstScreen, type HomeCtx } from "./data";

/**
 * Hoş geldin kredisi duyurusu: YALNIZ ofisin kullanılabilir hesap kredisi varsa gösterilir; tutar
 * `growth_referral_settings.welcome_credit_try` değerinden (my_dashboard RPC) okunur, kodda sabit değildir.
 * Gösterilen tutar mevcut kullanılabilir bakiyeyi aşmaz. Tıklayınca cüzdan sekmesine gider.
 */
export async function HosgeldinKredisi({ ctx }: { ctx: HomeCtx }) {
  if (!ctx.tenantId) return null;
  await afterFirstScreen(ctx); // ikincil bant: sorguları ilk ekran bitince başlar
  const supabase = await createClient();
  const [overview, dash] = await Promise.all([
    readTryOverview(supabase),
    readMyDashboard(supabase).catch(() => null),
  ]);
  const welcome = dash?.welcome_credit_try ?? 0;
  if (!overview || overview.available <= 0 || welcome <= 0) return null;
  const amount = Math.min(welcome, overview.available);
  return (
    <Link
      href="/app/abonelik?sekme=cuzdan"
      className="focus-ring press flex min-h-11 flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-mint-400/40 bg-mint-400/[0.08] px-4 py-2.5 text-sm text-ink-950 transition hover:border-mint-500/60"
    >
      <Gift className="h-4 w-4 shrink-0 text-mint-600" aria-hidden />
      <span>
        <span className="font-bold">{formatTry(amount)} hoş geldin krediniz</span>{" "}
        ödemede kullanılabilir.
      </span>
      <span className="ml-auto text-xs font-semibold underline underline-offset-2">Cüzdanı gör</span>
    </Link>
  );
}
