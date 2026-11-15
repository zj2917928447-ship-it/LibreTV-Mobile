import { describe, expect, it } from 'vitest';
import { createSearchIntent } from './search-intent';

describe('createSearchIntent', () => {
  it('keeps a valid search query navigable when no VOD source is selected', () => {
    expect(createSearchIntent(' 蜘蛛侠 ', 0)).toEqual({
      kind: 'needs-source',
      query: '蜘蛛侠',
      href: '/?s=%E8%9C%98%E8%9B%9B%E4%BE%A0',
    });
  });

  it('marks a search ready when at least one VOD source is selected', () => {
    expect(createSearchIntent('Spider-Man', 1)).toEqual({
      kind: 'ready',
      query: 'Spider-Man',
      href: '/?s=Spider-Man',
    });
  });

  it('rejects an empty query', () => {
    expect(createSearchIntent('   ', 3)).toEqual({ kind: 'empty' });
  });

  it('caps the query at the same 100-character limit as the search API', () => {
    const intent = createSearchIntent('x'.repeat(120), 1);
    expect(intent.kind).toBe('ready');
    if (intent.kind !== 'empty') {
      expect(intent.query).toBe('x'.repeat(100));
      expect(intent.href).toBe('/?s=' + 'x'.repeat(100));
    }
  });
});
