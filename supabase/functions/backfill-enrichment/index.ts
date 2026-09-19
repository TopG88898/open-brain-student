// One-time backfill: thoughts saved before Level 5's enrich-thought trigger
// existed have no tags/category/summary. Uses `enriched_at IS NULL` as the
// "still needs it" marker — same field enrich-thought sets going forward.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CATEGORIES = ['idea', 'learning', 'question', 'reference', 'plan', 'reflection', 'digest']
const MIN_LENGTH = 20

function dbHeaders() {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function callLLM(prompt: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/call-llm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      maxTokens: 300,
      systemPrompt: 'You respond with ONLY valid JSON. No markdown, no code fences, no explanation.',
    }),
  })
  if (!res.ok) throw new Error(`call-llm failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return data.text
}

function parseEnrichment(raw: string) {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const parsed = JSON.parse(cleaned)
  const category = CATEGORIES.includes(parsed.category) ? parsed.category : null
  const tags = Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5).map(String) : []
  const summary = typeof parsed.summary === 'string' ? parsed.summary : null
  return { tags, category, summary }
}

async function markEnrichedNoop(id: string) {
  // Content too short to bother enriching — still mark it done so it drops
  // out of the "needs enrichment" set and this backfill can finish.
  await fetch(`${SUPABASE_URL}/rest/v1/thoughts?id=eq.${id}`, {
    method: 'PATCH',
    headers: dbHeaders(),
    body: JSON.stringify({ enriched_at: new Date().toISOString() }),
  })
}

async function enrichOne(id: string, content: string) {
  const prompt = `Analyze this note and respond with ONLY this JSON shape, nothing else:
{"tags": ["tag1","tag2","tag3"], "category": "one of: ${CATEGORIES.join(', ')}", "summary": "one sentence, max 20 words"}

Note:
"""
${content.slice(0, 4000)}
"""`
  const raw = await callLLM(prompt)
  const enrichment = parseEnrichment(raw)
  const res = await fetch(`${SUPABASE_URL}/rest/v1/thoughts?id=eq.${id}`, {
    method: 'PATCH',
    headers: dbHeaders(),
    body: JSON.stringify({ ...enrichment, enriched_at: new Date().toISOString() }),
  })
  if (!res.ok) throw new Error(`Update failed: ${res.status} ${await res.text()}`)
}

async function countRemaining(): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/thoughts?select=id&enriched_at=is.null`, {
    headers: { ...dbHeaders(), Prefer: 'count=exact', Range: '0-0' },
  })
  const range = res.headers.get('content-range')
  return range ? parseInt(range.split('/')[1] ?? '0', 10) : 0
}

Deno.serve(async (req) => {
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const batchSize = typeof body.batch_size === 'number' ? body.batch_size : 5

    // No offset — rows with enriched_at set drop out of this filter, so
    // always taking the front of the remaining set (like backfill-embeddings)
    // is what keeps repeated calls correct.
    const url = `${SUPABASE_URL}/rest/v1/thoughts?select=id,content,category&enriched_at=is.null&order=created_at.asc&limit=${batchSize}`
    const res = await fetch(url, { headers: dbHeaders() })
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`)
    const batch: { id: string; content: string; category: string | null }[] = await res.json()

    let enriched = 0
    let skipped = 0
    let failed = 0

    for (const thought of batch) {
      // A digest already has its category set on purpose — don't let the AI re-tag it.
      if (thought.category === 'digest' || thought.content.length < MIN_LENGTH) {
        await markEnrichedNoop(thought.id)
        skipped++
        continue
      }
      try {
        await enrichOne(thought.id, thought.content)
        enriched++
      } catch (err) {
        console.error(`Enrichment failed for ${thought.id}:`, err)
        failed++
      }
    }

    const remaining = await countRemaining()

    return new Response(
      JSON.stringify({ processed: batch.length, enriched, skipped, failed, remaining }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
