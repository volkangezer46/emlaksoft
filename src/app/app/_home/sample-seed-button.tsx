"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { seedSampleData } from "@/app/actions/sample-data";

/** "Örnek veri yükle" — örnek set yüklenir, panel yenilenir; tek tıkla temizlenebilir. */
export function SampleSeedButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="secondary"
        icon={Sparkles}
        loading={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await seedSampleData();
            if (result.error) return setError(result.error);
            router.refresh();
          });
        }}
      >
        Örnek veri yükle
      </Button>
      {error ? <p className="w-full text-xs font-semibold text-danger-500">{error}</p> : null}
    </>
  );
}
