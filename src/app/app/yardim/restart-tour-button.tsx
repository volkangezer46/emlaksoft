"use client";

import { Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearTourDone, TOUR_RESTART_HREF } from "@/lib/product-tour-storage";

/** Ürün turunu baştan başlatır: "görüldü" işaretini siler ve ana ekranı ?tur=1 ile açar. */
export function RestartTourButton({ variant = "secondary" }: { variant?: "primary" | "secondary" }) {
  return (
    <Button
      variant={variant}
      icon={MapIcon}
      onClick={() => {
        clearTourDone();
        window.location.assign(TOUR_RESTART_HREF);
      }}
    >
      Turu yeniden başlat
    </Button>
  );
}
