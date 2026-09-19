// MCP (Model Context Protocol) server for Open Brain.
// Speaks JSON-RPC 2.0 over HTTP so any MCP-compatible AI (via a bridge like
// mcp-remote, or a native HTTP-MCP client) can search and add to the brain.

import { createPeople, type Candidate, type Identifier, type InteractionSource } from '../_shared/people.ts'
import { createRestPeopleStore } from '../_shared/people-store.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MCP_ACCESS_KEY = Deno.env.get('MCP_ACCESS_KEY')!

const people = createPeople({
  store: createRestPeopleStore({ supabaseUrl: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY }),
})

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

// ---------- the tools the AI can call ----------

const TOOLS = [
  {
    name: 'search_thoughts',
    description: 'Search everything saved in the brain (notes, YouTube transcripts, PDFs, voice captures, Telegram messages) by meaning, not just exact words — e.g. searching "how to get new clients" finds thoughts about "customer acquisition." Returns up to 10 matches with a similarity score and a truncated content snippet (~500 chars) per match, not the full text. Each match also includes up to 3 "linked" thoughts — other ideas the brain has automatically connected to it — so you can surface related context the user may have forgotten.',
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
  {
    name: 'upsert_person',
    description: 'Create or update the file on a person. Identity is decided by exact identifier (phone, email, Telegram handle), never by name alone. If the identifiers match an existing person, that person is returned (status "matched") and any new identifiers are added to them. If only the NAME matches someone, nothing is created and status is "possible_duplicate" with the candidates: ask the user whether it is the same person, then either call again with that candidate\'s "id" (same person) or with confirm_new=true (different person). Status "conflict" means the identifiers belong to two different existing people: never merge them, tell the user. Status "excluded" means the user asked never to track this person: do not create a file and do not mention their details. Pass "id" to update an existing person (name, relationship, follow-up, extra identifiers); a non-blank "name" renames them.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Existing person id, to update them' },
        name: { type: 'string', description: 'Full name (required when creating)' },
        identifiers: {
          type: 'array',
          description: 'How this person is recognised. Phone numbers may be written any way; emails are case-insensitive.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['phone', 'email', 'telegram', 'alias'] },
              value: { type: 'string' },
            },
            required: ['type', 'value'],
          },
        },
        relationship: { type: 'string', description: 'e.g. friend, colleague, client, family' },
        follow_up_at: { type: 'string', description: 'ISO 8601 date-time to follow up with them' },
        follow_up_note: { type: 'string', description: 'What the follow-up is about' },
        confirm_new: { type: 'boolean', description: 'Create a new person even though the name matches someone else. Only after the user confirms they are different.' },
      },
    },
  },
  {
    name: 'add_interaction',
    description: 'Add one dated entry to a person\'s timeline: a text conversation, email thread, meeting, or a note the user dictated (source "note"). Write "summary" yourself as a short factual summary of what happened or what the user said: never paste message text verbatim, and leave out sensitive topics (health, legal, financial) listed in the project parameters. Pass "source_ref" (e.g. a Gmail thread id) for anything that came from a source, so the same message is never stored twice (status "duplicate"). Notes do not count as contact. Pass "facts" for things THEY plainly said about themselves in this exchange (employer, city, what they study): each is saved as a Fact pointing at this entry, never overrides a fact the user stated himself, and never replaces a value taken from a newer message; the result lists each as set, unchanged or skipped. Regenerates the person\'s profile summary afterwards unless refresh_profile is false.',
    inputSchema: {
      type: 'object',
      properties: {
        person_id: { type: 'string' },
        source: { type: 'string', enum: ['imessage', 'email', 'note', 'meeting', 'telegram'] },
        summary: { type: 'string', description: 'Short factual summary, never verbatim message text' },
        occurred_at: { type: 'string', description: 'ISO 8601 date-time it happened (default: now)' },
        direction: { type: 'string', enum: ['in', 'out'], description: 'in = they contacted the user, out = the user contacted them' },
        source_ref: { type: 'string', description: 'Stable id of the source message or thread, for dedup' },
        facts: {
          type: 'array',
          description: 'What they plainly said about themselves in this exchange, never a guess and never a sensitive topic. Short lowercase key, e.g. employer, city, school.',
          items: {
            type: 'object',
            properties: { key: { type: 'string' }, value: { type: 'string' } },
            required: ['key', 'value'],
          },
        },
        refresh_profile: { type: 'boolean', description: 'Regenerate the profile summary after adding (default true)' },
        profile_max_words: { type: 'number', description: 'Profile length limit, from parameters.md' },
        avoid_topics: { type: 'array', items: { type: 'string' }, description: 'Topics the profile must never mention, from parameters.md' },
      },
      required: ['person_id', 'source', 'summary'],
    },
  },
  {
    name: 'set_fact',
    description: 'Record or correct one fact about a person, e.g. key "employer", value "Beacon". If the fact already has a different value, the old value is kept as history marked superseded, not deleted, so use this for corrections too ("actually she works at Beacon now"). Returns "unchanged" if the value is already recorded.',
    inputSchema: {
      type: 'object',
      properties: {
        person_id: { type: 'string' },
        key: { type: 'string', description: 'Short label, e.g. employer, city, birthday, partner' },
        value: { type: 'string' },
        profile_max_words: { type: 'number' },
        avoid_topics: { type: 'array', items: { type: 'string' } },
      },
      required: ['person_id', 'key', 'value'],
    },
  },
  {
    name: 'get_person',
    description: 'Read a person\'s whole file: profile summary, follow-up, identifiers, current facts, superseded facts (history), and their 20 most recent timeline entries. Look them up by id, exact name, or one identifier. Status "ambiguous" means several people share that name: ask which one.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        identifier_type: { type: 'string', enum: ['phone', 'email', 'telegram', 'alias'] },
        identifier_value: { type: 'string' },
      },
    },
  },
  {
    name: 'search_people',
    description: 'Find people by part of their name, and find timeline entries by meaning (e.g. "who mentioned moving?"). Returns matching people and the most relevant interactions with the person\'s name on each.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'A name fragment or a description of what happened' } },
      required: ['query'],
    },
  },
  {
    name: 'forget_person',
    description: 'PERMANENTLY delete a person\'s file (identifiers, facts, timeline) and add them to the exclusion list so they are never suggested again. This cannot be undone. Always call it first with confirm=false, tell the user whose file will be deleted, and call again with confirm=true only after they say yes.',
    inputSchema: {
      type: 'object',
      properties: {
        person_id: { type: 'string' },
        confirm: { type: 'boolean', description: 'true only after the user has explicitly confirmed' },
      },
      required: ['person_id', 'confirm'],
    },
  },
  {
    name: 'start_sync',
    description: 'Begin a sync of one source ("email", "imessage" or "meeting"). Returns "since": read messages from that time forward. It is where the last finished sync stopped, or "lookback_days" ago on the first sync. Note the current time BEFORE reading and pass it to finish_sync afterwards, so messages that arrive while you read are not missed (duplicates are harmless: source_ref dedups them).',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['email', 'imessage', 'meeting'] },
        lookback_days: { type: 'number', description: 'How far back the first sync reads, from parameters.md' },
      },
      required: ['source', 'lookback_days'],
    },
  },
  {
    name: 'finish_sync',
    description: 'Record that a source has been read up to "through" (the time you noted before reading). Call it only after every step of the sync succeeded, so a failed sync is retried from the same point. The marker never moves backwards.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['email', 'imessage', 'meeting'] },
        through: { type: 'string', description: 'ISO 8601 time the sync started reading' },
      },
      required: ['source', 'through'],
    },
  },
  {
    name: 'suggest_people',
    description: 'Decide who from a scan of texts or email is worth a file. Pass one candidate per person (group by identifier). From texts or email give "sent" and "received" (messages Ethan sent them and they sent Ethan) plus min_messages and min_each_way. From meetings give "meetings" ({ one_on_one, group }) plus min_one_on_one_meetings; set "automated" for rooms and note-taker bots. Thresholds come from parameters.md. Returns one result per candidate, in order: "suggested" (new, awaiting approval), "already_suggested" (still awaiting approval), "has_file" (already approved: add their interactions), "skipped" with a reason (below_threshold, one_way, automated, excluded, dismissed, invalid_identifier: say nothing about excluded people), "possible_duplicate" (same name as an existing person: ask Ethan) or "conflict" (identifiers on two files: report it, never merge). Nothing here sends, replies to or labels any message. Suggested people get no file until resolve_suggestion approves them.',
    inputSchema: {
      type: 'object',
      properties: {
        candidates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              identifiers: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { type: { type: 'string', enum: ['phone', 'email', 'telegram'] }, value: { type: 'string' } },
                  required: ['type', 'value'],
                },
              },
              sent: { type: 'number', description: 'Texts or email: messages Ethan sent this person in the scanned window' },
              received: { type: 'number', description: 'Texts or email: messages this person sent Ethan' },
              meetings: {
                type: 'object',
                description: 'Meetings: how often this person met Ethan in the scanned window',
                properties: {
                  one_on_one: { type: 'number', description: 'Meetings with only Ethan and this person' },
                  group: { type: 'number', description: 'Other meetings they attended, up to meeting_max_attendees' },
                },
                required: ['one_on_one', 'group'],
              },
              automated: { type: 'boolean', description: 'true if the sender looks like bulk, marketing or system mail (list headers, Promotions/Updates category)' },
            },
            required: ['name', 'identifiers'],
          },
        },
        min_messages: { type: 'number', description: 'suggest_min_messages from parameters.md (texts and email)' },
        min_each_way: { type: 'number', description: 'suggest_min_each_way from parameters.md (texts and email)' },
        min_one_on_one_meetings: { type: 'number', description: 'suggest_min_one_on_one_meetings from parameters.md (meetings)' },
        ignore_no_reply: { type: 'boolean', description: 'ignore_no_reply_senders from parameters.md' },
        queue_source: { type: 'string', enum: ['email', 'imessage', 'meeting'], description: 'Set this during an unattended sweep: everything that needs Ethan\'s decision (suggestions, possible duplicates, conflicts) is also left in the review queue, tagged with this source. Leave it out when Ethan is in the conversation.' },
      },
      required: ['candidates', 'ignore_no_reply'],
    },
  },
  {
    name: 'resolve_suggestion',
    description: 'Apply Ethan\'s decision on a suggested person: "approve" gives them a file (status active), "dismiss" means never suggest them again (they are remembered as dismissed, not deleted). Approving a dismissed person reverses the dismissal. Dismiss never touches an approved file: use forget_person for that. Only call this after Ethan has said which people to approve or dismiss.',
    inputSchema: {
      type: 'object',
      properties: {
        person_id: { type: 'string' },
        decision: { type: 'string', enum: ['approve', 'dismiss'] },
      },
      required: ['person_id', 'decision'],
    },
  },
  {
    name: 'list_review_queue',
    description: 'What a sweep left for Ethan to decide, oldest first, with a count. Kinds: "suggestion" (a new person awaiting approval: apply his answer with resolve_suggestion, which also clears it), "possible_duplicate" (same name as existing people in candidate_ids: ask whether it is the same person, act with upsert_person, then close_review_item) "conflict" (identifiers on two files in person_ids: report it, never merge, then close_review_item once he has seen it) and "unmatched_note" (a note he dictated in Telegram that could not be filed by name: detail.note is his text, detail.reason is no_match, ambiguous or not_approved, detail.candidate_ids are the people with that name; once he says whose file it belongs on, add it with add_interaction source "note", occurred_at from detail and source_ref the item\'s key, then close_review_item). Call it at the start of any people run and say how many are waiting. Nothing in the queue is applied without his answer.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'close_review_item',
    description: 'Clear a "possible_duplicate", "conflict" or "unmatched_note" item once Ethan has decided or seen it. This deletes the item. Suggestions cannot be closed here: use resolve_suggestion.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The review item id from list_review_queue' } },
      required: ['id'],
    },
  },
]

const SNIPPET_LENGTH = 500

function truncate(rows: { id: string; content: string; created_at: string; similarity?: number }[]) {
  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    ...(r.similarity !== undefined ? { similarity: Math.round(r.similarity * 100) / 100 } : {}),
    content: r.content.length > SNIPPET_LENGTH ? r.content.slice(0, SNIPPET_LENGTH) + '…' : r.content,
    truncated: r.content.length > SNIPPET_LENGTH,
  }))
}

async function generateEmbedding(text: string): Promise<number[] | null> {
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
}

const LINKED_SNIPPET_LENGTH = 200

// For each direct hit, pull its nearest graph neighbors too — so the AI sees
// not just what matched, but what those matches are connected to.
async function attachLinkedThoughts(rows: { id: string }[]) {
  return Promise.all(
    rows.map(async (row: any) => {
      const url = `${SUPABASE_URL}/rest/v1/thought_links?or=(source_thought_id.eq.${row.id},target_thought_id.eq.${row.id})&select=source_thought_id,target_thought_id,similarity_score&order=similarity_score.desc&limit=3`
      const res = await fetch(url, { headers: dbHeaders() })
      if (!res.ok) return { ...row, linked: [] }
      const links: { source_thought_id: string; target_thought_id: string; similarity_score: number }[] = await res.json()
      const neighborIds = links.map((l) => (l.source_thought_id === row.id ? l.target_thought_id : l.source_thought_id))
      if (!neighborIds.length) return { ...row, linked: [] }

      const neighborsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/thoughts?id=in.(${neighborIds.join(',')})&select=id,content`,
        { headers: dbHeaders() }
      )
      const neighbors: { id: string; content: string }[] = neighborsRes.ok ? await neighborsRes.json() : []
      const linked = links.map((l) => {
        const targetId = l.source_thought_id === row.id ? l.target_thought_id : l.source_thought_id
        const t = neighbors.find((n) => n.id === targetId)
        return {
          id: targetId,
          similarity: Math.round(l.similarity_score * 100) / 100,
          content: t ? (t.content.length > LINKED_SNIPPET_LENGTH ? t.content.slice(0, LINKED_SNIPPET_LENGTH) + '…' : t.content) : null,
        }
      })
      return { ...row, linked }
    })
  )
}

async function searchThoughts(query: string) {
  const embedding = await generateEmbedding(query)

  // Fall back to keyword search if embeddings are unavailable for any reason
  // (e.g. no OpenRouter credits) — search should degrade, not break.
  if (!embedding) {
    const url = `${SUPABASE_URL}/rest/v1/thoughts?select=id,content,created_at&content=ilike.*${encodeURIComponent(query)}*&order=created_at.desc&limit=10`
    const res = await fetch(url, { headers: dbHeaders() })
    if (!res.ok) throw new Error(`Search failed: ${res.status} ${await res.text()}`)
    return attachLinkedThoughts(truncate(await res.json()))
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_thoughts`, {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify({ query_embedding: embedding, match_threshold: 0.3, match_count: 10 }),
  })
  if (!res.ok) throw new Error(`Semantic search failed: ${res.status} ${await res.text()}`)
  return attachLinkedThoughts(truncate(await res.json()))
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

// ---------- people ----------

const optionalString = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)

async function summarizeWithLLM(prompt: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/call-llm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      maxTokens: 500,
      systemPrompt: 'You write concise, factual profile summaries. Output only the summary text.',
    }),
  })
  if (!res.ok) throw new Error(`call-llm failed: ${res.status} ${await res.text()}`)
  return (await res.json()).text
}

function profileOptions(args: Record<string, unknown>) {
  return {
    summarize: summarizeWithLLM,
    maxWords: typeof args.profile_max_words === 'number' ? args.profile_max_words : undefined,
    avoidTopics: Array.isArray(args.avoid_topics) ? args.avoid_topics.map(String) : undefined,
  }
}

async function upsertPerson(args: Record<string, unknown>) {
  return people.upsertPerson({
    id: optionalString(args.id),
    name: optionalString(args.name),
    identifiers: Array.isArray(args.identifiers) ? (args.identifiers as Identifier[]) : undefined,
    relationship: optionalString(args.relationship),
    follow_up_at: optionalString(args.follow_up_at),
    follow_up_note: optionalString(args.follow_up_note),
    confirm_new: args.confirm_new === true,
  })
}

function statedFacts(raw: unknown): { key: string; value: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw
    .filter((f): f is { key: unknown; value: unknown } => typeof f === 'object' && f !== null)
    .map((f) => ({ key: String(f.key ?? ''), value: String(f.value ?? '') }))
}

async function addInteraction(args: Record<string, unknown>) {
  const summary = String(args.summary ?? '')
  // Embedding is best-effort: the entry still saves, it just isn't semantically searchable.
  const embedding = summary.trim() ? await generateEmbedding(summary) : null
  const result = await people.addInteraction({
    person_id: String(args.person_id ?? ''),
    source: String(args.source ?? '') as InteractionSource,
    summary,
    occurred_at: optionalString(args.occurred_at),
    direction: args.direction === 'in' || args.direction === 'out' ? args.direction : undefined,
    source_ref: optionalString(args.source_ref),
    embedding: embedding ?? undefined,
    facts: statedFacts(args.facts),
  })
  if (result.status !== 'added' || args.refresh_profile === false) return result
  const profile = await people.refreshProfile(String(args.person_id), profileOptions(args))
  return { ...result, profile }
}

async function setFact(args: Record<string, unknown>) {
  const personId = String(args.person_id ?? '')
  const result = await people.setFact(personId, String(args.key ?? ''), String(args.value ?? ''))
  if (result.status !== 'set') return result
  const profile = await people.refreshProfile(personId, profileOptions(args))
  return { ...result, profile }
}

async function getPerson(args: Record<string, unknown>) {
  const identifier = optionalString(args.identifier_value)
    ? ({ type: String(args.identifier_type ?? ''), value: String(args.identifier_value) } as Identifier)
    : undefined
  return people.getPerson({ id: optionalString(args.id), name: optionalString(args.name), identifier })
}

async function searchPeople(query: string) {
  const fragment = encodeURIComponent(`*${query.replace(/[\\%_*]/g, (c) => `\\${c}`)}*`)
  const peopleRes = await fetch(
    `${SUPABASE_URL}/rest/v1/people?name=ilike.${fragment}&select=id,name,relationship,profile_summary,last_contact_at,follow_up_at&limit=10`,
    { headers: dbHeaders() },
  )
  if (!peopleRes.ok) throw new Error(`People search failed: ${peopleRes.status} ${await peopleRes.text()}`)

  // Like search_thoughts: meaning first, keywords if embeddings are unavailable. The cutoff is
  // lower than search_thoughts (0.3): short queries like "moving" score ~0.25 against a note
  // that says "moved to Denver", and a personal file set is small enough to absorb the noise.
  const embedding = await generateEmbedding(query)
  const interactionsRes = embedding
    ? await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_interactions`, {
        method: 'POST',
        headers: dbHeaders(),
        body: JSON.stringify({ query_embedding: embedding, match_threshold: 0.2, match_count: 10 }),
      })
    : await fetch(
        `${SUPABASE_URL}/rest/v1/interactions?summary=ilike.${fragment}&select=id,person_id,source,occurred_at,summary&order=occurred_at.desc&limit=10`,
        { headers: dbHeaders() },
      )
  if (!interactionsRes.ok) {
    throw new Error(`Interaction search failed: ${interactionsRes.status} ${await interactionsRes.text()}`)
  }
  return { people: await peopleRes.json(), interactions: await interactionsRes.json() }
}

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'upsert_person':
      return await upsertPerson(args)
    case 'add_interaction':
      return await addInteraction(args)
    case 'set_fact':
      return await setFact(args)
    case 'get_person':
      return await getPerson(args)
    case 'search_people':
      return await searchPeople(String(args.query ?? ''))
    case 'forget_person':
      return await people.forgetPerson(String(args.person_id ?? ''), { confirm: args.confirm === true })
    case 'start_sync':
      return await people.startSync(String(args.source ?? ''), {
        lookback_days: typeof args.lookback_days === 'number' ? args.lookback_days : 30,
      })
    case 'finish_sync':
      return await people.finishSync(String(args.source ?? ''), String(args.through ?? ''))
    case 'suggest_people':
      return await people.suggestPeople({
        candidates: Array.isArray(args.candidates) ? (args.candidates as Candidate[]) : [],
        criteria: {
          min_messages: Number(args.min_messages),
          min_each_way: Number(args.min_each_way),
          min_one_on_one_meetings: Number(args.min_one_on_one_meetings),
          ignore_no_reply: args.ignore_no_reply !== false,
        },
        queue: optionalString(args.queue_source) ? { source: String(args.queue_source) } : undefined,
      })
    case 'list_review_queue':
      return await people.listReviewQueue()
    case 'close_review_item':
      return await people.closeReviewItem(String(args.id ?? ''))
    case 'resolve_suggestion':
      // No default: an unrecognised decision must never be read as approval.
      if (args.decision !== 'approve' && args.decision !== 'dismiss') {
        throw new Error('decision must be "approve" or "dismiss"')
      }
      return await people.resolveSuggestion(String(args.person_id ?? ''), args.decision)
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
        serverInfo: { name: 'open-brain-mcp', version: '1.5.0' },
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
