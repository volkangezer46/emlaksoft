"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function TekliflerError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Teklifler" />;
}
