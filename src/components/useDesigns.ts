"use client";

import { useCallback, useEffect, useState } from "react";
import type { Price } from "@/lib/price";

export type PublicDesign = {
  id: string;
  name: string;
  createdAt: string;
  imageUrl: string;
  purchaseUrl: string | null;
  price: Price | null;
};

export function useDesigns() {
  const [designs, setDesigns] = useState<PublicDesign[]>([]);
  const [error, setError] = useState<string | null>(null);

  /**
   * Refetches the gallery. The store can lag a few seconds behind a change, so
   * a just-saved design can be passed in to keep it (or keep it out) until the
   * server catches up.
   */
  const reload = useCallback(async (pending?: { upsert?: PublicDesign; removedId?: string }) => {
    try {
      const res = await fetch("/api/designs", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { designs: PublicDesign[] };
      let list = body.designs;
      if (pending?.removedId) list = list.filter((d) => d.id !== pending.removedId);
      const upsert = pending?.upsert;
      if (upsert) {
        list = list.some((d) => d.id === upsert.id)
          ? list.map((d) => (d.id === upsert.id ? upsert : d))
          : [upsert, ...list];
      }
      setDesigns(list);
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
