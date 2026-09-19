/**
 * The people module: who is in the brain, how they are recognised, and what is on their file.
 *
 * Pure logic over a PeopleStore port, so the rules that can go wrong silently (identity
 * matching, dedup, corrections, deletion) are tested without a database. The Supabase adapter
 * lives in people-store.ts; the MCP tools in open-brain-mcp call this module.
 */

export type IdentifierType = 'phone' | 'email' | 'telegram' | 'alias'
export type ExclusionType = IdentifierType | 'domain'

export interface Identifier {
  type: IdentifierType
  value: string
}

export interface ExclusionEntry {
  type: ExclusionType
  value: string
}

export const INTERACTION_SOURCES = ['imessage', 'email', 'note', 'meeting', 'telegram'] as const
export type InteractionSource = (typeof INTERACTION_SOURCES)[number]

/** Sources a Sync can read today. Meetings and Telegram arrive with the scheduled Sweep. */
export const SYNC_SOURCES = ['email', 'imessage'] as const

export type PersonStatus = 'suggested' | 'active' | 'dismissed'

export interface Person {
  id: string
  name: string
  status: PersonStatus
  relationship: string | null
  profile_summary: string | null
  profile_updated_at: string | null
  last_contact_at: string | null
  follow_up_at: string | null
  follow_up_note: string | null
  created_at: string
}

export type PersonFields = Partial<Omit<Person, 'id' | 'created_at'>>

export interface Interaction {
  id: string
  person_id: string
  source: InteractionSource
  occurred_at: string
  summary: string
  direction: 'in' | 'out' | null
  source_ref: string | null
  created_at: string
}

export interface NewInteraction {
  person_id: string
  source: InteractionSource
  occurred_at: string
  summary: string
  direction: 'in' | 'out' | null
  source_ref: string | null
  embedding: number[] | null
}

export interface Fact {
  id: string
  person_id: string
  key: string
  value: string
  superseded_at: string | null
  created_at: string
}

/** What needs Ethan's decision. A Sweep leaves these for him instead of asking. */
export type ReviewKind = 'suggestion' | 'possible_duplicate' | 'conflict'

export interface ReviewDetail {
  source: string
  identifiers: Identifier[]
  sent?: number
  received?: number
  /** possible_duplicate: the existing people who share the name. */
  candidate_ids?: string[]
  /** conflict: the existing people who each own one of the identifiers. */
  person_ids?: string[]
}

export interface ReviewItem {
  id: string
  kind: ReviewKind
  /** What makes two items the same question: the person id, the identifiers, or the owner ids. */
  key: string
  person_id: string | null
  subject: string
  detail: ReviewDetail
  created_at: string
}

export type NewReviewItem = Omit<ReviewItem, 'id' | 'created_at'>

/** Everything the module needs from storage. Each method is one specific operation. */
export interface PeopleStore {
  /** Distinct ids of people who own any of these identifiers (exact match). */
  personIdsByIdentifiers(ids: Identifier[]): Promise<string[]>
  /** People whose name, or a name alias, equals `name` ignoring case. */
  peopleByName(name: string): Promise<Person[]>
  getPerson(id: string): Promise<Person | null>
  insertPerson(fields: PersonFields & { name: string }): Promise<Person>
  updatePerson(id: string, fields: PersonFields): Promise<Person>
  addIdentifiers(personId: string, ids: Identifier[]): Promise<void>
  identifiersOf(personId: string): Promise<Identifier[]>
  /** Returns null when this (source, source_ref) is already stored. */
  insertInteraction(row: NewInteraction): Promise<Interaction | null>
  /** Newest first. */
  recentInteractions(personId: string, limit: number): Promise<Interaction[]>
  factsOf(personId: string): Promise<Fact[]>
  supersedeFact(factId: string, at: string): Promise<void>
  insertFact(personId: string, key: string, value: string): Promise<Fact>
  /** Removes the person and everything that hangs off them. */
  deletePerson(id: string): Promise<void>
  addExclusions(entries: ExclusionEntry[]): Promise<void>
  /** True if any entry is on the exclusion list (exact match). */
  anyExcluded(entries: ExclusionEntry[]): Promise<boolean>
  /** When the last Sync of this source finished reading, or null if none has. */
  getSyncedAt(source: string): Promise<string | null>
  setSyncedAt(source: string, at: string): Promise<void>
  /** Saves a review item. There is one per (kind, key): a repeat updates its detail. */
  saveReviewItem(item: NewReviewItem): Promise<ReviewItem>
  /** Oldest first. */
  openReviewItems(): Promise<ReviewItem[]>
  getReviewItem(id: string): Promise<ReviewItem | null>
  /** Deletes the item: once Ethan has decided, nothing about the person needs to stay here. */
  closeReviewItems(kind: ReviewKind, key: string): Promise<void>
}

export interface PeopleDeps {
  store: PeopleStore
  now?: () => Date
  /** Digits assumed for phone numbers written without a country code. */
  defaultCountryCode?: string
}

export interface UpsertPersonInput {
  id?: string
  name?: string
  identifiers?: Identifier[]
  relationship?: string
  follow_up_at?: string
  follow_up_note?: string
  /** Create a new person even though the name matches someone who already exists. */
  confirm_new?: boolean
}

export type UpsertPersonResult =
  | { status: 'created' | 'matched' | 'updated'; person: Person }
  | { status: 'possible_duplicate'; candidates: Person[] }
  | { status: 'conflict'; person_ids: string[] }
  | { status: 'excluded' }

export interface AddInteractionInput {
  person_id: string
  source: InteractionSource
  summary: string
  occurred_at?: string
  direction?: 'in' | 'out'
  source_ref?: string
  embedding?: number[]
}

export type AddInteractionResult =
  | { status: 'added'; interaction: Interaction }
  | { status: 'duplicate' }

export type SetFactResult =
  | { status: 'set'; fact: Fact; superseded: Fact | null }
  | { status: 'unchanged'; fact: Fact }

export interface GetPersonInput {
  id?: string
  name?: string
  identifier?: Identifier
}

export type GetPersonResult =
  | {
      status: 'found'
      person: Person
      identifiers: Identifier[]
      facts: { active: Fact[]; superseded: Fact[] }
      interactions: Interaction[]
    }
  | { status: 'ambiguous'; candidates: Person[] }
  | { status: 'not_found' }

export type ForgetPersonResult =
  | { status: 'confirmation_required'; person: Person }
  | { status: 'forgotten'; name: string }
  | { status: 'not_found' }

export interface RefreshProfileOptions {
  summarize: (prompt: string) => Promise<string>
  maxWords?: number
  avoidTopics?: string[]
}

export type RefreshProfileResult =
  | { status: 'refreshed'; summary: string }
  | { status: 'failed'; reason: string }

/** One person seen in a scan of texts or email, with how much they and Ethan wrote to each other. */
export interface Candidate {
  name: string
  identifiers: Identifier[]
  /** Messages Ethan sent them. */
  sent: number
  /** Messages they sent Ethan. */
  received: number
  /** The caller's own judgement that this is a bulk, marketing or system sender. */
  automated?: boolean
}

export interface SuggestCriteria {
  min_messages: number
  min_each_way: number
  ignore_no_reply: boolean
}

export type SuggestionSkipReason =
  | 'below_threshold'
  | 'one_way'
  | 'automated'
  | 'excluded'
  | 'dismissed'
  | 'invalid_identifier'

/** What became of one candidate, in the same order as the candidates passed in. */
export type SuggestionResult =
  | { status: 'suggested' | 'already_suggested' | 'has_file'; person: Person }
  | { status: 'skipped'; reason: SuggestionSkipReason }
  | { status: 'possible_duplicate'; candidates: Person[] }
  | { status: 'conflict'; person_ids: string[] }

export type ResolveSuggestionResult =
  | { status: 'approved' | 'dismissed' | 'unchanged'; person: Person }
  | { status: 'not_found' }

export type CloseReviewItemResult = { status: 'closed' } | { status: 'not_found' }

export interface People {
  /** For a possible_duplicate or conflict Ethan has dealt with. A suggestion is closed by resolveSuggestion. */
  closeReviewItem(id: string): Promise<CloseReviewItemResult>
  listReviewQueue(): Promise<{ count: number; items: ReviewItem[] }>
  /** Where a Sync of this source should start reading. */
  startSync(source: string, opts: { lookback_days: number }): Promise<{ since: string }>
  /** Record that everything up to `through` has been read. Never moves the marker backwards. */
  finishSync(source: string, through: string): Promise<{ last_synced_at: string }>
  resolveSuggestion(personId: string, decision: 'approve' | 'dismiss'): Promise<ResolveSuggestionResult>
  /**
   * With `queue`, everything that needs Ethan's decision is also left in the review queue, tagged
   * with the source it came from. Without it the caller is a live conversation that asks him itself.
   */
  suggestPeople(input: {
    candidates: Candidate[]
    criteria: SuggestCriteria
    queue?: { source: string }
  }): Promise<SuggestionResult[]>
  upsertPerson(input: UpsertPersonInput): Promise<UpsertPersonResult>
  addInteraction(input: AddInteractionInput): Promise<AddInteractionResult>
  setFact(personId: string, key: string, value: string): Promise<SetFactResult>
  getPerson(input: GetPersonInput): Promise<GetPersonResult>
  forgetPerson(personId: string, opts: { confirm: boolean }): Promise<ForgetPersonResult>
  refreshProfile(personId: string, opts: RefreshProfileOptions): Promise<RefreshProfileResult>
}

/** Canonical form of an identifier, so "(303) 555-0142" and "+13035550142" are the same key. */
function normalizeIdentifier(raw: Identifier, defaultCountryCode: string): Identifier {
  const value = raw.value.trim()
  switch (raw.type) {
    case 'phone': {
      const digits = value.replace(/\D/g, '')
      if (digits.length < 7) throw new Error(`invalid phone number: "${raw.value}"`)
      if (value.startsWith('+')) return { type: 'phone', value: `+${digits}` }
      if (digits.length === 10) return { type: 'phone', value: `+${defaultCountryCode}${digits}` }
      return { type: 'phone', value: `+${digits}` }
    }
    case 'email': {
      if (!/^[^\s@]+@[^\s@]+$/.test(value)) throw new Error(`invalid email: "${raw.value}"`)
      return { type: 'email', value: value.toLowerCase() }
    }
    case 'telegram': {
      const handle = value.replace(/^@/, '').toLowerCase()
      if (!handle) throw new Error('invalid telegram handle')
      return { type: 'telegram', value: handle }
    }
    case 'alias': {
      if (!value) throw new Error('invalid alias')
      return { type: 'alias', value: value.toLowerCase() }
    }
    default:
      throw new Error(`invalid identifier type "${(raw as Identifier).type}" (use phone, email, telegram, alias)`)
  }
}

/** Local parts that only ever belong to a system: mail sent from these is never a person. */
const AUTOMATED_LOCAL_PART =
  /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer-daemon|postmaster|bounces?|notifications?|newsletters?|marketing|alerts?)([-_.+].*)?$/i

function looksAutomated(identifiers: Identifier[]): boolean {
  return identifiers.some((i) => i.type === 'email' && AUTOMATED_LOCAL_PART.test(i.value.split('@')[0]))
}

function definedOnly(fields: PersonFields): PersonFields {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
}

/**
 * What to check against (and, when forgetting, add to) the exclusion list for one person:
 * each contact identifier, the domain of each email, and the name only when nothing else
 * identifies them.
 */
function exclusionEntries(identifiers: Identifier[], name?: string): ExclusionEntry[] {
  const contact = identifiers.filter((i) => i.type !== 'alias')
  if (!contact.length) return name?.trim() ? [{ type: 'alias', value: name.trim().toLowerCase() }] : []
  return contact.flatMap((i): ExclusionEntry[] =>
    i.type === 'email' ? [i, { type: 'domain', value: i.value.split('@')[1] }] : [i],
  )
}

function profilePrompt(
  person: Person,
  facts: Fact[],
  interactions: Interaction[],
  maxWords: number,
  avoidTopics: string[],
): string {
  const active = facts.filter((f) => f.superseded_at === null)
  return [
    `You maintain a private file on ${person.name}${person.relationship ? ` (${person.relationship})` : ''}.`,
    `Write a profile summary of at most ${maxWords} words, in plain prose, using only the facts and interactions below.`,
    'State only what the facts and interactions say. Do not speculate, interpret, or comment on their significance. Do not quote messages verbatim.',
    avoidTopics.length ? `Never mention: ${avoidTopics.join(', ')}.` : '',
    '',
    'Current facts:',
    ...(active.length ? active.map((f) => `- ${f.key}: ${f.value}`) : ['- none']),
    '',
    'Recent interactions (newest first):',
    ...(interactions.length
      ? interactions.map((i) => `- [${i.occurred_at.slice(0, 10)} ${i.source}] ${i.summary}`)
      : ['- none']),
  ]
    .filter((line, n, all) => line !== '' || all[n - 1] !== '')
    .join('\n')
}

export function createPeople(deps: PeopleDeps): People {
  const { store } = deps
  const now = deps.now ?? (() => new Date())
  const defaultCountryCode = deps.defaultCountryCode ?? '1'
  const normalizeAll = (ids: Identifier[] = []) =>
    ids.map((i) => normalizeIdentifier(i, defaultCountryCode))

  async function decideCandidate(
    candidate: Candidate,
    criteria: SuggestCriteria,
  ): Promise<{ result: SuggestionResult; identifiers: Identifier[] }> {
    const done = (result: SuggestionResult, identifiers: Identifier[] = []) => ({ result, identifiers })
    let identifiers: Identifier[]
    try {
      identifiers = normalizeAll(candidate.identifiers)
    } catch {
      return done({ status: 'skipped', reason: 'invalid_identifier' })
    }
    if (await store.anyExcluded(exclusionEntries(identifiers, candidate.name))) {
      return done({ status: 'skipped', reason: 'excluded' })
    }
    const owners = await store.personIdsByIdentifiers(identifiers.filter((i) => i.type !== 'alias'))
    if (owners.length > 1) return done({ status: 'conflict', person_ids: owners }, identifiers)
    if (owners.length === 1) {
      const owner = await store.getPerson(owners[0])
      if (!owner) throw new Error(`identifier points at a missing person: ${owners[0]}`)
      if (owner.status === 'dismissed') return done({ status: 'skipped', reason: 'dismissed' })
      await store.addIdentifiers(owner.id, identifiers)
      return done({ status: owner.status === 'active' ? 'has_file' : 'already_suggested', person: owner }, identifiers)
    }
    if (criteria.ignore_no_reply && (candidate.automated || looksAutomated(identifiers))) {
      return done({ status: 'skipped', reason: 'automated' })
    }
    if (candidate.sent + candidate.received < criteria.min_messages) {
      return done({ status: 'skipped', reason: 'below_threshold' })
    }
    if (candidate.sent < criteria.min_each_way || candidate.received < criteria.min_each_way) {
      return done({ status: 'skipped', reason: 'one_way' })
    }
    // A shared name is a hint, never proof: Ethan decides whether this is someone new.
    const sameName = await store.peopleByName(candidate.name)
    if (sameName.length) return done({ status: 'possible_duplicate', candidates: sameName }, identifiers)
    const person = await store.insertPerson({ name: candidate.name.trim(), status: 'suggested' })
    await store.addIdentifiers(person.id, identifiers)
    return done({ status: 'suggested', person }, identifiers)
  }

  /** Leaves what only Ethan can decide in the review queue. Everything else is not his to review. */
  async function queueForReview(
    result: SuggestionResult,
    candidate: Candidate,
    identifiers: Identifier[],
    source: string,
  ) {
    const seen = { source, identifiers, sent: candidate.sent, received: candidate.received }
    const identifierKey = identifiers.map((i) => `${i.type}:${i.value}`).sort().join('|')
    switch (result.status) {
      case 'suggested':
      case 'already_suggested':
        await store.saveReviewItem({
          kind: 'suggestion',
          key: result.person.id,
          person_id: result.person.id,
          subject: result.person.name,
          detail: seen,
        })
        break
      case 'possible_duplicate':
        await store.saveReviewItem({
          kind: 'possible_duplicate',
          key: identifierKey,
          person_id: null,
          subject: candidate.name.trim(),
          detail: { ...seen, candidate_ids: result.candidates.map((c) => c.id) },
        })
        break
      case 'conflict':
        await store.saveReviewItem({
          kind: 'conflict',
          key: [...result.person_ids].sort().join('|'),
          person_id: null,
          subject: candidate.name.trim(),
          detail: { ...seen, person_ids: result.person_ids },
        })
        break
    }
  }

  function assertSyncable(source: string) {
    if (!(SYNC_SOURCES as readonly string[]).includes(source)) {
      throw new Error(`"${source}" cannot be synced (use ${SYNC_SOURCES.join(', ')})`)
    }
  }

  return {
    async startSync(source, { lookback_days }) {
      assertSyncable(source)
      const last = await store.getSyncedAt(source)
      if (last) return { since: new Date(last).toISOString() }
      return { since: new Date(now().getTime() - lookback_days * 86_400_000).toISOString() }
    },

    async finishSync(source, through) {
      assertSyncable(source)
      const at = new Date(through)
      if (Number.isNaN(at.getTime())) throw new Error(`invalid time: "${through}"`)
      const last = await store.getSyncedAt(source)
      const latest = last && new Date(last) > at ? new Date(last) : at
      await store.setSyncedAt(source, latest.toISOString())
      return { last_synced_at: latest.toISOString() }
    },

    async resolveSuggestion(personId, decision) {
      const person = await store.getPerson(personId)
      if (!person) return { status: 'not_found' }
      // Whatever the answer, Ethan has now looked at this person: the question is no longer open.
      await store.closeReviewItems('suggestion', personId)

      // Approval also reverses a dismissal. Dismissal never demotes an approved file: forget does that.
      if (decision === 'approve' && person.status !== 'active') {
        return { status: 'approved', person: await store.updatePerson(personId, { status: 'active' }) }
      }
      if (decision === 'dismiss' && person.status === 'suggested') {
        return { status: 'dismissed', person: await store.updatePerson(personId, { status: 'dismissed' }) }
      }
      return { status: 'unchanged', person }
    },

    async suggestPeople({ candidates, criteria, queue }) {
      // A missing threshold compares as false against everything, which would suggest every sender.
      for (const key of ['min_messages', 'min_each_way'] as const) {
        if (!Number.isFinite(criteria[key])) throw new Error(`${key} must be a number`)
      }
      for (const candidate of candidates) {
        for (const key of ['sent', 'received'] as const) {
          if (!Number.isFinite(candidate[key])) throw new Error(`${key} must be a number for "${candidate.name}"`)
        }
      }
      const results: SuggestionResult[] = []
      for (const candidate of candidates) {
        const { result, identifiers } = await decideCandidate(candidate, criteria)
        if (queue) await queueForReview(result, candidate, identifiers, queue.source)
        results.push(result)
      }
      return results
    },

    async closeReviewItem(id) {
      const item = await store.getReviewItem(id)
      if (!item) return { status: 'not_found' }
      if (item.kind === 'suggestion') {
        throw new Error('a suggestion is closed by resolveSuggestion: approve or dismiss the person')
      }
      await store.closeReviewItems(item.kind, item.key)
      return { status: 'closed' }
    },

    async listReviewQueue() {
      const items = await store.openReviewItems()
      return { count: items.length, items }
    },

    async upsertPerson(input) {
      const identifiers = normalizeAll(input.identifiers)
      const owners = await store.personIdsByIdentifiers(identifiers.filter((i) => i.type !== 'alias'))
      const fields: PersonFields = {
        relationship: input.relationship,
        follow_up_at: input.follow_up_at,
        follow_up_note: input.follow_up_note,
      }

      if (input.id) {
        // Someone else already owns one of these identifiers: attaching it here would be a merge.
        const others = owners.filter((owner) => owner !== input.id)
        if (others.length) return { status: 'conflict', person_ids: [input.id, ...others] }
        await store.addIdentifiers(input.id, identifiers)
        const person = await store.updatePerson(input.id, definedOnly(fields))
        return { status: 'updated', person }
      }

      if (await store.anyExcluded(exclusionEntries(identifiers, input.name))) {
        return { status: 'excluded' }
      }

      if (owners.length > 1) return { status: 'conflict', person_ids: owners }
      if (owners.length === 1) {
        await store.addIdentifiers(owners[0], identifiers)
        const person = await store.updatePerson(owners[0], definedOnly(fields))
        return { status: 'matched', person }
      }

      if (!input.name?.trim()) throw new Error('name is required to create a person')

      // A shared name is a hint, never proof. The caller decides whether this is someone new.
      if (!input.confirm_new) {
        const candidates = await store.peopleByName(input.name)
        if (candidates.length) return { status: 'possible_duplicate', candidates }
      }

      const person = await store.insertPerson({
        name: input.name.trim(),
        relationship: input.relationship,
        follow_up_at: input.follow_up_at,
        follow_up_note: input.follow_up_note,
      })
      await store.addIdentifiers(person.id, identifiers)
      return { status: 'created', person }
    },

    async getPerson(input) {
      let person: Person | null = null
      if (input.id) {
        person = await store.getPerson(input.id)
      } else if (input.identifier) {
        const [id] = await store.personIdsByIdentifiers([
          normalizeIdentifier(input.identifier, defaultCountryCode),
        ])
        person = id ? await store.getPerson(id) : null
      } else if (input.name) {
        const candidates = await store.peopleByName(input.name)
        if (candidates.length > 1) return { status: 'ambiguous', candidates }
        person = candidates[0] ?? null
      }
      if (!person) return { status: 'not_found' }

      const facts = await store.factsOf(person.id)
      return {
        status: 'found',
        person,
        identifiers: await store.identifiersOf(person.id),
        facts: {
          active: facts.filter((f) => f.superseded_at === null),
          superseded: facts.filter((f) => f.superseded_at !== null),
        },
        interactions: await store.recentInteractions(person.id, 20),
      }
    },

    async addInteraction(input) {
      if (!(INTERACTION_SOURCES as readonly string[]).includes(input.source)) {
        throw new Error(`invalid source "${input.source}" (use ${INTERACTION_SOURCES.join(', ')})`)
      }
      const summary = input.summary.trim()
      if (!summary) throw new Error('summary is required')
      const person = await store.getPerson(input.person_id)
      if (!person) throw new Error(`no such person: ${input.person_id}`)
      if (person.status !== 'active') {
        throw new Error(`${person.name} is ${person.status}, not approved: approve them before adding to their file`)
      }

      const occurredAt = new Date(input.occurred_at ?? now().toISOString()).toISOString()
      const interaction = await store.insertInteraction({
        person_id: person.id,
        source: input.source,
        occurred_at: occurredAt,
        summary,
        direction: input.direction ?? null,
        source_ref: input.source_ref ?? null,
        embedding: input.embedding ?? null,
      })
      if (!interaction) return { status: 'duplicate' }

      // A note is something you wrote about them, not something they did: it is not contact.
      const isContact = input.source !== 'note'
      const isNewest = !person.last_contact_at || new Date(occurredAt) > new Date(person.last_contact_at)
      if (isContact && isNewest) await store.updatePerson(person.id, { last_contact_at: occurredAt })

      return { status: 'added', interaction }
    },

    async setFact(personId, key, value) {
      const cleanKey = key.trim().toLowerCase()
      const cleanValue = value.trim()
      if (!cleanKey || !cleanValue) throw new Error('key and value are required')
      const person = await store.getPerson(personId)
      if (!person) throw new Error(`no such person: ${personId}`)

      const current = (await store.factsOf(personId)).find(
        (f) => f.key === cleanKey && f.superseded_at === null,
      )
      if (current?.value === cleanValue) return { status: 'unchanged', fact: current }

      // Supersede first: the database allows only one active fact per key.
      if (current) await store.supersedeFact(current.id, now().toISOString())
      const fact = await store.insertFact(personId, cleanKey, cleanValue)
      return { status: 'set', fact, superseded: current ?? null }
    },

    async forgetPerson(personId, opts) {
      const person = await store.getPerson(personId)
      if (!person) return { status: 'not_found' }
      if (!opts.confirm) return { status: 'confirmation_required', person }

      // Exclude before deleting, so the person is never re-suggested by a later sweep.
      const identifiers = await store.identifiersOf(person.id)
      await store.addExclusions(exclusionEntries(identifiers, person.name).filter((e) => e.type !== 'domain'))
      await store.closeReviewItems('suggestion', person.id)
      await store.deletePerson(person.id)
      return { status: 'forgotten', name: person.name }
    },

    async refreshProfile(personId, opts) {
      const person = await store.getPerson(personId)
      if (!person) throw new Error(`no such person: ${personId}`)

      try {
        const prompt = profilePrompt(
          person,
          await store.factsOf(personId),
          await store.recentInteractions(personId, 30),
          opts.maxWords ?? 120,
          opts.avoidTopics ?? [],
        )
        const summary = (await opts.summarize(prompt)).trim()
        if (!summary) return { status: 'failed', reason: 'empty summary' }
        await store.updatePerson(personId, {
          profile_summary: summary,
          profile_updated_at: now().toISOString(),
        })
        return { status: 'refreshed', summary }
      } catch (err) {
        // Best-effort: a failed refresh must never damage the profile that is already there.
        return { status: 'failed', reason: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
