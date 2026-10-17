"use client";

import { useCallback, useEffect, useState } from "react";

export type PublicDesign = { id: string; name: string; createdAt: string; imageUrl: string };

export function useDesigns() {
  const [designs, setDesigns] = useState<PublicDesign[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/designs", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { designs: PublicDesign[] };
      setDesigns(body.designs);
      setError(null);
    } catch {
      setError("We couldn't load the design gallery. Please refresh the page.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    reload();
  }, [reload]);

  return { designs, error, reload };
}
