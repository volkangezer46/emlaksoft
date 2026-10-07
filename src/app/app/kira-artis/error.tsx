"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function KiraArtisError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Kira artışı" />;
}
