"use client";

// GEÇİCİ doğrulama düzeneği (commit EDİLMEZ): panoyu sahte veriyle gerçek tarayıcıda dener.
import { ToastProvider } from "@/components/app/toast-provider";
import { DealBoard } from "../app/anlasmalar/deal-board-lazy";
import type { BoardDeal } from "../app/anlasmalar/deal-board";

const base = {
  deal_type: "sale",
  probability: 40,
  assigned_to: "m1",
  updated_at: "2026-10-01T10:00:00.000Z",
  property_code: null,
  property_id: "p1",
  customer_id: "c1",
  note_count: 2,
  checklist_done: 1,
  checklist_total: 3,
};

const DEALS: BoardDeal[] = [
  { ...base, id: "deal-new-1", stage: "new", deal_value: 4_500_000, property_title: "Moda 3+1 Daire", customer_name: "Ayşe Yılmaz" },
  { ...base, id: "deal-new-2", stage: "new", deal_value: 2_100_000, property_title: "Kartal 2+1", customer_name: "Mehmet Demir" },
  { ...base, id: "deal-q-1", stage: "qualified", deal_value: 7_800_000, property_title: "Bostancı Dubleks", customer_name: "Zeynep Kaya" },
  { ...base, id: "deal-n-1", stage: "negotiation", deal_value: 12_000_000, property_title: "Çengelköy Villa", customer_name: "Ali Vural" },
  { ...base, id: "deal-n-2", stage: "negotiation", deal_type: "rent", deal_value: 45_000, property_title: "Kadıköy Ofis (kira)", customer_name: "Selin Ak" },
  { ...base, id: "deal-w-1", stage: "won", deal_value: 9_000_000, property_title: "Ataşehir Rezidans", customer_name: "Can Öz" },
  { ...base, id: "deal-l-1", stage: "lost", deal_value: 3_000_000, property_title: "Maltepe 1+1", customer_name: "Ece Tan" },
];

export function Harness({ canEdit }: { canEdit: boolean }) {
  return (
    <ToastProvider>
      {/* Uygulama şablonunu taklit eder: dönüşümlü üst öğe + üstte içerik (dikey kaydırma). */}
      <div className="page-in vt-page mx-auto max-w-[1400px] space-y-5 p-4" style={{ transform: "translateY(0)" }}>
        <h1 className="text-lg font-bold">dnd harness</h1>
        <div className="h-40 rounded border border-line bg-surface p-3 text-sm">üst içerik</div>
        <DealBoard deals={DEALS} canEdit={canEdit} members={[{ id: "m1", full_name: "Deniz Arı" }]} />
        <div className="h-[600px] rounded border border-line bg-surface p-3 text-sm">alt içerik</div>
      </div>
    </ToastProvider>
  );
}
