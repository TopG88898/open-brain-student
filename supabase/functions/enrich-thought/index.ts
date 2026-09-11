// Triggered by a Supabase Database Webhook on INSERT into `thoughts`.
// Asks the LLM gateway for tags/category/summary, then writes them back.
// Webhook functions should never fail the insert, so this always returns 200.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CATEGORIES = ['idea', 'learning', 'question', 'reference', 'plan', 'reflection']
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
  // Models sometimes wrap JSON in ```json fences despite instructions — strip if present.
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const parsed = JSON.parse(cleaned)
  const category = CATEGORIES.includes(parsed.category) ? parsed.category : null
  const tags = Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5).map(String) : []
  const summary = typeof parsed.summary === 'string' ? parsed.summary : null
  return { tags, category, summary }
}

async function updateThought(id: string, enrichment: { tags: string[]; category: string | null; summary: string | null }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/thoughts?id=eq.${id}`, {
    method: 'PATCH',
    headers: dbHeaders(),
    body: JSON.stringify({ ...enrichment, enriched_at: new Date().toISOString() }),
  })
  if (!res.ok) throw new Error(`Update failed: ${res.status} ${await res.text()}`)
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json()
    const record = payload?.record
    const id = record?.id
    const content: string = record?.content ?? ''

    if (!id || content.length < MIN_LENGTH) {
      return new Response('ok', { status: 200 })
    }

    const prompt = `Analyze this note and respond with ONLY this JSON shape, nothing else:
{"tags": ["tag1","tag2","tag3"], "category": "one of: ${CATEGORIES.join(', ')}", "summary": "one sentence, max 20 words"}

Note:
"""
${content.slice(0, 4000)}
"""`

    const raw = await callLLM(prompt)
    const enrichment = parseEnrichment(raw)
    await updateThought(id, enrichment)

    return new Response('ok', { status: 200 })
  } catch (err) {
    console.error('enrich-thought error:', err)
    // Never fail the webhook — the thought is already saved either way.
    return new Response('ok', { status: 200 })
  }
})
