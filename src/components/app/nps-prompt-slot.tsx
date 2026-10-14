import { loadNpsPrompt } from "@/lib/product-feedback/store";
import { NpsPromptLazy } from "./office-shell-lazy";

/**
 * Ürün içi NPS yuvası (DG8): kendi Suspense sınırında AKAR, kabuğu bekletmez. Bayrak hedeflemesi (`nps_survey`),
 * sıklık sınırı ve hedef segment SUNUCUDA değerlendirilir; sorulacak anket yoksa hiçbir şey çizilmez ve anket kodu
 * indirilmez. Gösterim, istemci anketi ekrana getirdiğinde yazılır (önceden yükleme gösterim saymaz).
 */
export async function NpsPromptSlot({ tenantId, userId, role, plan }: { tenantId: string; userId: string; role: string; plan: string | null }) {
  const prompt = await loadNpsPrompt({ tenantId, userId, role, plan });
  if (!prompt) return null;
  return <NpsPromptLazy surveyId={prompt.surveyId} question={prompt.question} />;
}
