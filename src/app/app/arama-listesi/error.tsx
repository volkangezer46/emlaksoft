"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AramaListesiError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Arama listesi" />;
}
