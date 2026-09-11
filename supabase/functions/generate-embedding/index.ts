// Converts text into a 1536-number vector representing its meaning.
// Routed through OpenRouter so the embedding provider is swappable —
// same LLM-agnostic gateway pattern as call-llm in Level 5.
//
// To switch embedding providers: change EMBEDDING_MODEL below (or make it
// an env var like LLM_MODEL). The vector dimension must stay 1536 unless
// you also run a new migration to resize the `embedding` column.

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')
const EMBEDDING_MODEL = 'openai/text-embedding-3-small'
const TIMEOUT_MS = 15000
// text-embedding-3-small caps input at 8191 tokens (~4 chars/token). A long
// YouTube transcript or PDF can easily blow past that, so we truncate here —
// once, for every caller — rather than relying on each caller to remember to.
const MAX_INPUT_CHARS = 20000

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

async function embed(text: string): Promise<number[] | null> {
  if (!OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set')
    return null
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
      signal: controller.signal,
    })

    if (!res.ok) {
      console.error('OpenRouter embedding error:', res.status, await res.text())
      return null
    }

    const data = await res.json()
    return data.data?.[0]?.embedding ?? null
  } catch (err) {
    console.error('Embedding request failed:', err)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    const { text } = await req.json()
    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ embedding: null, error: 'Missing "text"' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const embedding = await embed(text.slice(0, MAX_INPUT_CHARS))
    return new Response(JSON.stringify({ embedding }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    // Callers should be able to continue without an embedding rather than crash.
    return new Response(JSON.stringify({ embedding: null }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
