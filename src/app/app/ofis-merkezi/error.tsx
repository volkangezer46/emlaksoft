"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function OfisMerkeziError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Ofis merkezi" />;
}
