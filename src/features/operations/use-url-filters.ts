'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';

/**
 * Filters live in the URL so a filtered list can be bookmarked, shared and
 * opened from the Office Home cards. Setting a value to its default (or '')
 * removes it from the URL.
 */
export function useUrlFilters(defaults: Record<string, string> = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const set = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(search.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (!value || value === defaults[key]) next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, {
          scroll: false
        });
      });
    },
    // defaults is a literal at each call site; its contents are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, pathname, search]
  );

  return {
    get: (key: string) => search.get(key) ?? defaults[key] ?? '',
    set,
    pending
  };
}
