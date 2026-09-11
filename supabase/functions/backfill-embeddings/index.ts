// One-time (well, run-until-done) backfill: existing thoughts saved before
// Level 6 have no embedding yet. This processes them in small batches so we
// don't blow past API rate limits, and can be safely re-run — it always
// looks for embedding IS NULL, so already-processed thoughts are skipped.

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

async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-embedding`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.embedding ?? null
  } catch {
    return null
  }
}

async function countRemaining(): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/thoughts?select=id&embedding=is.null`, {
    headers: dbHeaders({ Prefer: 'count=exact', Range: '0-0' }),
  })
  const range = res.headers.get('content-range') // "0-0/1234"
  return range ? parseInt(range.split('/')[1] ?? '0', 10) : 0
}

Deno.serve(async (req) => {
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const batchSize = typeof body.batch_size === 'number' ? body.batch_size : 5

    // No offset: rows with a freshly-written embedding drop out of this
    // filter, so always grabbing the front of the remaining-null set (rather
    // than paging by offset) is what keeps this correct across repeated calls.
    const url = `${SUPABASE_URL}/rest/v1/thoughts?select=id,content&embedding=is.null&order=created_at.asc&limit=${batchSize}`
    const res = await fetch(url, { headers: dbHeaders() })
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`)
    const batch: { id: string; content: string }[] = await res.json()

    let embedded = 0
    let failed = 0

    for (const thought of batch) {
      const vec = await generateEmbedding(thought.content)
      if (!vec) {
        failed++
        continue
      }
      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/thoughts?id=eq.${thought.id}`, {
        method: 'PATCH',
        headers: dbHeaders(),
        body: JSON.stringify({ embedding: vec }),
      })
      if (updateRes.ok) embedded++
      else failed++
    }

    const remaining = await countRemaining()

    return new Response(
      JSON.stringify({ processed: batch.length, embedded, failed, remaining }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
