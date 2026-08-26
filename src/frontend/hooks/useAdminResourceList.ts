"use client";

import { useCallback, useEffect, useState } from "react";

// shared fetch/loading/error state for the admin project sub-panels (documents, staff notes, etc.)
export function useAdminResourceList<T, TResponse = unknown>(
  url: string,
  extract: (data: TResponse) => T[],
  errorMessage = "Failed to load data"
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(errorMessage);
      }
      const data = (await res.json()) as TResponse;
      setItems(extract(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
    // extract/errorMessage are expected to be stable per call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { items, setItems, loading, error, refetch };
}
