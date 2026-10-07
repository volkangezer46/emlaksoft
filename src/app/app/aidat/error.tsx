"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AidatError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Aidat" />;
}
