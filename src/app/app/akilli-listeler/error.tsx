"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AkilliListelerError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Akıllı listeler" />;
}
