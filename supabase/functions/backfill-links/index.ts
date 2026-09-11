// One-time backfill: thoughts that existed before Level 6's auto-linking was
// wired in have embeddings (from backfill-embeddings) but no links yet.
// Unlike the embeddings backfill, "has an embedding" doesn't shrink as we
// process rows, so plain offset pagination is safe and correct here.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function dbHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

async function hasExistingLink(thoughtId: string): Promise<boolean> {
  const url = `${SUPABASE_URL}/rest/v1/thought_links?or=(source_thought_id.eq.${thoughtId},target_thought_id.eq.${thoughtId})&select=id&limit=1`
  const res = await fetch(url, { headers: dbHeaders() })
  if (!res.ok) return false
  const rows = await res.json()
  return rows.length > 0
}

async function findLinks(thoughtId: string, embedding: number[] | string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/find_links_for_thought`, {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify({
      source_id: thoughtId,
      source_embedding: embedding,
      match_threshold: 0.4,
      match_count: 5,
    }),
  })
  if (!res.ok) throw new Error(`RPC failed: ${res.status} ${await res.text()}`)
  return res.json() as Promise<{ target_id: string; similarity: number }[]>
}

async function insertLinks(sourceId: string, neighbors: { target_id: string; similarity: number }[]) {
  if (!neighbors.length) return
  const links = neighbors.map((n) => ({
    source_thought_id: sourceId,
    target_thought_id: n.target_id,
    similarity_score: n.similarity,
    link_type: 'semantic',
  }))
  await fetch(`${SUPABASE_URL}/rest/v1/thought_links`, {
    method: 'POST',
    headers: { ...dbHeaders(), Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify(links),
  })
}

async function totalWithEmbedding(): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/thoughts?select=id&embedding=not.is.null`, {
    headers: dbHeaders({ Prefer: 'count=exact', Range: '0-0' }),
  })
  const range = res.headers.get('content-range')
  return range ? parseInt(range.split('/')[1] ?? '0', 10) : 0
}

Deno.serve(async (req) => {
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const batchSize = typeof body.batch_size === 'number' ? body.batch_size : 3
    const offset = typeof body.offset === 'number' ? body.offset : 0

    const url = `${SUPABASE_URL}/rest/v1/thoughts?select=id,embedding&embedding=not.is.null&order=created_at.asc&offset=${offset}&limit=${batchSize}`
    const res = await fetch(url, { headers: dbHeaders() })
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`)
    const batch: { id: string; embedding: string }[] = await res.json()

    let linked = 0
    let alreadyDone = 0

    for (const thought of batch) {
      if (await hasExistingLink(thought.id)) {
        alreadyDone++
        continue
      }
      try {
        const neighbors = await findLinks(thought.id, thought.embedding)
        await insertLinks(thought.id, neighbors)
        linked++
      } catch (err) {
        console.error(`Linking failed for ${thought.id}:`, err)
      }
    }

    const total = await totalWithEmbedding()
    const offsetNext = offset + batch.length
    const remaining = Math.max(total - offsetNext, 0)

    return new Response(
      JSON.stringify({ processed: batch.length, linked, already_done: alreadyDone, offset_next: offsetNext, remaining }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
