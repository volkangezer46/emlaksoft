"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function BolgeAnaliziError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Bölge analizi" />;
}
