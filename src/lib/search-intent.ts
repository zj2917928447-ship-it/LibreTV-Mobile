export type SearchIntent =
  | { kind: 'empty' }
  | { kind: 'ready' | 'needs-source'; query: string; href: string };

/**
 * Build a shareable search navigation target before deciding whether the user
 * currently has a source configured. Missing sources should block the request,
 * not discard the query or keep the user trapped on the recommendation page.
 */
export function createSearchIntent(rawQuery: string, selectedSourceCount: number): SearchIntent {
  const query = rawQuery.trim().slice(0, 100);
  if (!query) return { kind: 'empty' };

  return {
    kind: selectedSourceCount > 0 ? 'ready' : 'needs-source',
    query,
    href: `/?s=${encodeURIComponent(query)}`,
  };
}
