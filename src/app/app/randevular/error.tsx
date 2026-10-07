"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function RandevularError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Randevular" />;
}
