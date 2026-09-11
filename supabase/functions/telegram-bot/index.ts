// Telegram webhook -> Open Brain
// Receives a message from Telegram, saves it as a thought (or searches
// existing thoughts), and replies back to the user in Telegram.

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function dbHeaders() {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function saveThought(content: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/thoughts`, {
    method: 'POST',
    headers: { ...dbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(`Insert failed: ${res.status} ${await res.text()}`)
}

async function searchThoughts(term: string) {
  const url = `${SUPABASE_URL}/rest/v1/thoughts?select=content,created_at&content=ilike.*${encodeURIComponent(term)}*&order=created_at.desc&limit=5`
  const res = await fetch(url, { headers: dbHeaders() })
  if (!res.ok) throw new Error(`Search failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function recentThoughts() {
  const url = `${SUPABASE_URL}/rest/v1/thoughts?select=content,created_at&order=created_at.desc&limit=5`
  const res = await fetch(url, { headers: dbHeaders() })
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`)
  return res.json()
}

function formatThoughtList(rows: { content: string; created_at: string }[]) {
  if (!rows.length) return 'Nothing found.'
  return rows
    .map((r, i) => {
      const date = new Date(r.created_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
      const snippet = r.content.length > 300 ? r.content.slice(0, 300) + '…' : r.content
      return `${i + 1}. ${snippet}\n   (${date})`
    })
    .join('\n\n')
}

async function sendTelegramMessage(chatId: number, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
  })
  if (!res.ok) {
    console.error('Telegram sendMessage failed:', res.status, await res.text())
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  // Telegram only ever sends POST. Always answer 200 so Telegram doesn't retry.
  if (req.method !== 'POST') {
    return new Response('ok', { status: 200, headers: CORS_HEADERS })
  }

  try {
    const update = await req.json()
    const message = update?.message
    const chatId = message?.chat?.id
    const text: string | undefined = message?.text

    if (!chatId || !text) {
      return new Response('ok', { status: 200, headers: CORS_HEADERS })
    }

    const trimmed = text.trim()

    if (trimmed.startsWith('/recent')) {
      const rows = await recentThoughts()
      await sendTelegramMessage(chatId, `Your last ${rows.length} thoughts:\n\n${formatThoughtList(rows)}`)
    } else if (trimmed.startsWith('/search') || trimmed.startsWith('?')) {
      const term = trimmed.replace(/^\/search/, '').replace(/^\?/, '').trim()
      if (!term) {
        await sendTelegramMessage(chatId, 'Send /search followed by a word, e.g. "/search hormozi"')
      } else {
        const rows = await searchThoughts(term)
        await sendTelegramMessage(chatId, `Results for "${term}":\n\n${formatThoughtList(rows)}`)
      }
    } else {
      await saveThought(trimmed)
      await sendTelegramMessage(chatId, '✓ Saved to your brain')
    }

    return new Response('ok', { status: 200, headers: CORS_HEADERS })
  } catch (err) {
    console.error(err)
    // Still 200 — Telegram treats non-200 as "retry forever", which we don't want.
    return new Response('ok', { status: 200, headers: CORS_HEADERS })
  }
})
