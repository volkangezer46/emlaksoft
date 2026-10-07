"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function TavsiyelerError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Tavsiyeler" />;
}
