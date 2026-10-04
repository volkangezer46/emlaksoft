/**
 * Panel sayfa geçişi — iki katmanlı progressive enhancement:
 *
 * 1) View Transitions destekleyen tarayıcı: React <ViewTransition> (Next 16.3+, yapılandırma gerekmez)
 *    navigasyonda tarayıcının native cross-fade'ini tetikler; süre/easing
 *    globals.css'te ::view-transition-*(root) ve .page-fade sınıfında (--motion-nav, 150ms).
 *    Bu durumda .motion-page animasyonu hiç tanımlanmaz (motion.css: `@supports not
 *    (view-transition-name: root)`) — çift animasyon olmaz.
 * 2) Desteklemeyen tarayıcı: .motion-page ile aynı sürede hafif fade + 4px yükselme (yedek).
 *
 * Not: canary TİP augmentasyonu triple-slash ile yüklenir (runtime importu Turbopack'te
 * çözülemiyor); çalışma zamanında App Router'ın React sürümü ViewTransition'ı export ediyor.
 */
/// <reference types="react/canary" />
import { ViewTransition } from "react";
import { ViewTransitionGuard } from "@/components/app/view-transition-guard";

export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition default="page-fade">
      <div className="motion-page">
        <ViewTransitionGuard />
        {children}
      </div>
    </ViewTransition>
  );
}
