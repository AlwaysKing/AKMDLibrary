// Streaming search client for GET /api/spaces/{slug}/search/stream.
//
// The backend emits NDJSON (one JSON object per line, flushed immediately).
// We use the raw fetch + ReadableStream reader rather than axios because we
// need to surface each hit as soon as it arrives, not buffer the full
// response. An AbortController is plumbed through so the caller can cancel a
// long-running search when the user closes the overlay or types a new query.

export type SearchMode = 'title' | 'all';

export interface SearchHit {
  page_id: string;
  path: string;
  title: string;
  match_type: 'filename' | 'content';
}

export interface StreamSearchOptions {
  spaceSlug: string;
  query: string;
  subtree?: string; // "" = whole space; else relative dir path
  mode?: SearchMode; // default 'title'
  signal?: AbortSignal;
  onHit: (hit: SearchHit) => void;
}

export async function streamSearch(opts: StreamSearchOptions): Promise<void> {
  const { spaceSlug, query, subtree, mode = 'title', signal, onHit } = opts;

  const params = new URLSearchParams();
  params.set('q', query);
  if (subtree) params.set('subtree', subtree);
  params.set('mode', mode);

  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {
    Accept: 'application/x-ndjson',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/search/stream?${params.toString()}`, {
    method: 'GET',
    headers,
    signal,
  });

  if (!res.ok) {
    throw new Error(`search failed: ${res.status}`);
  }
  if (!res.body) {
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  // Chunks arrive on arbitrary byte boundaries. We accumulate into `buffer`
  // and split on "\n"; the trailing partial line stays in `buffer` for the
  // next chunk. The final flush handles a possible line without trailing \n.
  const flushLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const hit = JSON.parse(trimmed) as SearchHit;
      onHit(hit);
    } catch {
      // Skip malformed lines — backend is expected to send one JSON object
      // per line, but a partial line mid-stream shouldn't kill the whole
      // search.
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      flushLine(line);
    }
  }
  // Final tail (no trailing newline).
  buffer += decoder.decode();
  flushLine(buffer);
}
