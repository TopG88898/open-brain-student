// Called weekly by pg_cron. Reads the last 7 days of thoughts, asks the LLM
// gateway to summarize them, and saves the result back as a new thought
// (category: 'digest') so it shows up in the brain like anything else.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const MIN_THOUGHTS = 5

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
    body: JSON.stringify({ prompt, maxTokens: 1000 }),
  })
  if (!res.ok) throw new Error(`call-llm failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return data.text
}

async function getLastWeekThoughts() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const url = `${SUPABASE_URL}/rest/v1/thoughts?select=content,category,created_at&created_at=gte.${since}&or=(category.is.null,category.neq.digest)&order=created_at.asc`
  const res = await fetch(url, { headers: dbHeaders() })
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function saveDigest(content: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/thoughts`, {
    method: 'POST',
    headers: { ...dbHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify({ content, category: 'digest' }),
  })
  if (!res.ok) throw new Error(`Save failed: ${res.status} ${await res.text()}`)
  return (await res.json())[0]
}

Deno.serve(async (_req) => {
  try {
    const thoughts = await getLastWeekThoughts()

    if (thoughts.length < MIN_THOUGHTS) {
      console.log(`Only ${thoughts.length} thoughts in the last 7 days — skipping digest (need ${MIN_THOUGHTS}+).`)
      return new Response(JSON.stringify({ skipped: true, count: thoughts.length }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const grouped: Record<string, string[]> = {}
    for (const t of thoughts) {
      const cat = t.category || 'uncategorized'
      grouped[cat] = grouped[cat] || []
      grouped[cat].push(t.content.slice(0, 500))
    }

    const groupedText = Object.entries(grouped)
      .map(([cat, items]) => `## ${cat}\n${items.map((c) => `- ${c}`).join('\n')}`)
      .join('\n\n')

    const prompt = `Here are everything I captured in my personal knowledge base over the last 7 days, grouped by category:

${groupedText}

Write a short weekly digest (plain text, no markdown headers) covering:
1. What I was learning this week — the main topics
2. Key themes that showed up more than once
3. One open question I seem to be exploring based on this content

Keep it to about 200 words, written directly to me ("you"), like a friendly weekly report.`

    const digestText = await callLLM(prompt)
    const saved = await saveDigest(digestText)

    return new Response(JSON.stringify({ saved: true, id: saved.id, thoughtsConsidered: thoughts.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('weekly-digest error:', err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
