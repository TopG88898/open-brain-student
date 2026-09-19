// Telegram webhook -> Open Brain
// Receives a message from Telegram, saves it as a thought (or searches
// existing thoughts), and replies back to the user in Telegram.
//
// Only Ethan's own chat, delivered by the webhook he registered with a secret token, is served.
// A message starting with @Name is a note about a person and goes to that person's file
// (see _shared/telegram-note.ts); anything the bot cannot file is left in the review queue.

import { createPeople } from '../_shared/people.ts'
import { createRestPeopleStore } from '../_shared/people-store.ts'
import { isFromEthan, parsePersonNote, sensitiveTopicRefusal, touchesSensitiveTopic } from '../_shared/telegram-note.ts'

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ALLOWED_CHAT_ID = Deno.env.get('TELEGRAM_ALLOWED_CHAT_ID')
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')

const people = createPeople({
  store: createRestPeopleStore({ supabaseUrl: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY }),
})

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

// Best-effort: a note still saves without one, it just isn't found by meaning.
async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-embedding`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) return null
    return (await res.json()).embedding ?? null
  } catch {
    return null
  }
}

async function replyToPersonNote(
  name: string,
  note: string,
  message: { message_id: number; date?: number; chat: { id: number } },
): Promise<string> {
  if (touchesSensitiveTopic(note)) {
    return sensitiveTopicRefusal()
  }
  const result = await people.recordNote({
    name,
    note,
    source_ref: `telegram:${message.chat.id}:${message.message_id}`,
    occurred_at: message.date ? new Date(message.date * 1000).toISOString() : undefined,
    embedding: (await generateEmbedding(note)) ?? undefined,
  })
  switch (result.status) {
    case 'added':
      return `✓ Added to ${result.person.name}'s file`
    case 'duplicate':
      return 'Already saved.'
    case 'excluded':
      return 'Not saved: you asked me to forget them.'
    case 'queued': {
      const why = {
        no_match: `No file for "${name}".`,
        ambiguous: `More than one "${name}" has a file.`,
        not_approved: `"${name}" hasn't been approved yet.`,
      }[result.reason]
      return `${why} Kept in your review queue.`
    }
  }
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

  let replyTo: number | undefined
  try {
    const update = await req.json()
    const message = update?.message
    const chatId = message?.chat?.id
    const text: string | undefined = message?.text

    if (!chatId || !text) {
      return new Response('ok', { status: 200, headers: CORS_HEADERS })
    }

    // Anyone who finds this URL can post to it. Drop everything that is not Ethan's chat via his webhook.
    if (
      !isFromEthan({
        chatId,
        secretHeader: req.headers.get('x-telegram-bot-api-secret-token'),
        allowedChatId: ALLOWED_CHAT_ID,
        expectedSecret: WEBHOOK_SECRET,
      })
    ) {
      console.error(`Rejected a message from chat ${chatId}: not the allowed chat, or a bad or missing webhook secret`)
      return new Response('ok', { status: 200, headers: CORS_HEADERS })
    }
    replyTo = chatId

    const trimmed = text.trim()
    const personNote = parsePersonNote(trimmed)

    if (personNote) {
      await sendTelegramMessage(chatId, await replyToPersonNote(personNote.name, personNote.note, message))
    } else if (trimmed.startsWith('/recent')) {
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
    // Only Ethan's chat is ever set: a note that failed to save must not fail silently.
    if (replyTo) await sendTelegramMessage(replyTo, 'Something went wrong; that was not saved.')
    // Still 200 — Telegram treats non-200 as "retry forever", which we don't want.
    return new Response('ok', { status: 200, headers: CORS_HEADERS })
  }
})
