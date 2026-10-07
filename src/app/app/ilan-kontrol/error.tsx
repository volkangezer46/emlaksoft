"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function IlanKontrolError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="İlan kontrol" />;
}
