"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button type="button" variant="secondary" icon={Printer} onClick={() => window.print()}>
      Yazdır / PDF kaydet
    </Button>
  );
}
