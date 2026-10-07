"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function OfisKontrolError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Ofis kontrol" />;
}
