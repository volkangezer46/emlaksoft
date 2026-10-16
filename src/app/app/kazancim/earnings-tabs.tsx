"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { HandCoins, Wallet } from "lucide-react";
import { SegmentTabs, type SegmentTabItem } from "@/components/ui/segment-tabs";
import { earningsPath } from "@/lib/finance/routes";

/** Kazancım iç sekmeleri (gerçek yollar): Kazancım (`/app/kazancim`) · Kasam (`/app/kazancim/kasam`). */
export function EarningsTabs({ earnings }: { earnings: boolean }) {
  const segment = useSelectedLayoutSegment();
  const items: SegmentTabItem[] = [
    ...(earnings ? [{ id: "benim", href: earningsPath("benim"), label: "Kazancım", icon: HandCoins }] : []),
    { id: "kasam", href: earningsPath("kasam"), label: "Kasam", icon: Wallet },
  ];
  return <SegmentTabs label="Kazancım sekmeleri" items={items} active={segment === "kasam" ? "kasam" : "benim"} className="no-print" />;
}
