"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AnlasmalarError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Anlaşmalar" />;
}
