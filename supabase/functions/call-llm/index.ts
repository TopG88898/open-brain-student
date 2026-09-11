// LLM gateway. Every agent (enrich-thought, weekly-digest, future ones) calls
// THIS function instead of calling an AI provider directly.
//
// To switch providers: change LLM_PROVIDER in Supabase secrets (e.g. to
// 'openai' or 'gemini'), add that provider's API key as a secret, and add a
// branch below. No other code — no agent — has to change.

const LLM_PROVIDER = Deno.env.get('LLM_PROVIDER') ?? 'anthropic'
const LLM_MODEL = Deno.env.get('LLM_MODEL') ?? 'claude-haiku-4-5-20251001'
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

interface CallLLMRequest {
  prompt: string
  systemPrompt?: string
  model?: string
  maxTokens?: number
}

async function callAnthropic(req: CallLLMRequest): Promise<string> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: req.model || LLM_MODEL,
      max_tokens: req.maxTokens || 1024,
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.prompt }],
    }),
  })

  if (!res.ok) {
    throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`)
  }

  const data = await res.json()
  return data.content?.[0]?.text ?? ''
}

// Add a new provider by writing a callX() function above and a case below.
// Every agent keeps working unchanged — only this switch and the secrets change.
async function callProvider(req: CallLLMRequest): Promise<string> {
  switch (LLM_PROVIDER) {
    case 'anthropic':
      return await callAnthropic(req)
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${LLM_PROVIDER}`)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Expected POST' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body: CallLLMRequest = await req.json()
    if (!body.prompt) {
      return new Response(JSON.stringify({ error: 'Missing "prompt"' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    const text = await callProvider(body)
    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
