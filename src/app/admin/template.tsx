/**
 * Admin sayfa geçişi — /app ile AYNI sistem (tek kaynak, bkz. src/app/app/template.tsx):
 * View Transitions destekleyen tarayıcıda React <ViewTransition> native cross-fade
 * (globals.css `::view-transition-*`, --motion-nav 150 ms; yalnız opacity), desteklemeyende
 * motion.css `.motion-page` yedeği (fade + 4 px). Hareket azaltmada ikisi de kapalı.
 * Eski `.page-in` animasyonu bu birleşmeyle kaldırıldı (iki ayrı geçiş dili vardı).
 */
/// <reference types="react/canary" />
import { ViewTransition } from "react";
import { ViewTransitionGuard } from "@/components/app/view-transition-guard";

export default function AdminTemplate({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition default="page-fade">
      <div className="motion-page">
        <ViewTransitionGuard />
        {children}
      </div>
    </ViewTransition>
  );
}
