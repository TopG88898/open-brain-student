// MCP (Model Context Protocol) server for Open Brain.
// Speaks JSON-RPC 2.0 over HTTP so any MCP-compatible AI (via a bridge like
// mcp-remote, or a native HTTP-MCP client) can search and add to the brain.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MCP_ACCESS_KEY = Deno.env.get('MCP_ACCESS_KEY')!

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function dbHeaders() {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }
}

// ---------- the three tools the AI can call ----------

const TOOLS = [
  {
    name: 'search_thoughts',
    description: 'Search everything saved in the brain (notes, YouTube transcripts, PDFs, voice captures, Telegram messages) by keyword. Returns up to 10 matches with a truncated content snippet (~500 chars) per match, not the full text.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Keyword or phrase to search for' } },
      required: ['query'],
    },
  },
  {
    name: 'list_recent',
    description: 'List the most recently saved thoughts in the brain.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'How many to return (default 10)' } },
    },
  },
  {
    name: 'add_thought',
    description: 'Save a new thought, idea, or note directly into the brain.',
    inputSchema: {
      type: 'object',
      properties: { content: { type: 'string', description: 'The text to save' } },
      required: ['content'],
    },
  },
]

const SNIPPET_LENGTH = 500

function truncate(rows: { id: string; content: string; created_at: string }[]) {
  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    content: r.content.length > SNIPPET_LENGTH ? r.content.slice(0, SNIPPET_LENGTH) + '…' : r.content,
    truncated: r.content.length > SNIPPET_LENGTH,
  }))
}

async function searchThoughts(query: string) {
  const url = `${SUPABASE_URL}/rest/v1/thoughts?select=id,content,created_at&content=ilike.*${encodeURIComponent(query)}*&order=created_at.desc&limit=10`
  const res = await fetch(url, { headers: dbHeaders() })
  if (!res.ok) throw new Error(`Search failed: ${res.status} ${await res.text()}`)
  return truncate(await res.json())
}

async function listRecent(limit = 10) {
  const url = `${SUPABASE_URL}/rest/v1/thoughts?select=id,content,created_at&order=created_at.desc&limit=${limit}`
  const res = await fetch(url, { headers: dbHeaders() })
  if (!res.ok) throw new Error(`List failed: ${res.status} ${await res.text()}`)
  return truncate(await res.json())
}

async function addThought(content: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/thoughts`, {
    method: 'POST',
    headers: { ...dbHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(`Insert failed: ${res.status} ${await res.text()}`)
  const rows = await res.json()
  return rows[0]
}

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'search_thoughts':
      return await searchThoughts(String(args.query ?? ''))
    case 'list_recent':
      return await listRecent(typeof args.limit === 'number' ? args.limit : 10)
    case 'add_thought':
      return await addThought(String(args.content ?? ''))
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ---------- JSON-RPC plumbing ----------

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return new Response('MCP server expects POST', { status: 405, headers: CORS_HEADERS })
  }

  // Every real call must carry the shared secret.
  const auth = req.headers.get('Authorization') ?? ''
  if (auth !== `Bearer ${MCP_ACCESS_KEY}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify(rpcError(null, -32700, 'Parse error')), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const { id, method, params } = body

  try {
    // MCP handshake: the client introduces itself, we confirm we speak MCP.
    if (method === 'initialize') {
      return json(rpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'open-brain-mcp', version: '1.0.0' },
      }))
    }

    // Notification — no response body expected, just acknowledge.
    if (method === 'notifications/initialized') {
      return new Response(null, { status: 202, headers: CORS_HEADERS })
    }

    if (method === 'tools/list') {
      return json(rpcResult(id, { tools: TOOLS }))
    }

    if (method === 'tools/call') {
      const name = String(params?.name ?? '')
      const args = (params?.arguments as Record<string, unknown>) ?? {}
      const data = await callTool(name, args)
      return json(rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      }))
    }

    if (method === 'ping') {
      return json(rpcResult(id, {}))
    }

    return json(rpcError(id, -32601, `Method not found: ${method}`))
  } catch (err) {
    console.error(err)
    return json(rpcError(id, -32000, err instanceof Error ? err.message : 'Internal error'))
  }
})

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
