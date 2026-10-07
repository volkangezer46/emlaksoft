"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function YatirimError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Yatırım analizi" />;
}
