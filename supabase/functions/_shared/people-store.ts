/**
 * PeopleStore over Supabase's REST API (PostgREST), using the service-role key.
 * The people tables have RLS on and no anon policy, so nothing else can read them.
 */

import type {
  ExclusionEntry,
  Fact,
  Identifier,
  Interaction,
  NewInteraction,
  NewReviewItem,
  PeopleStore,
  Person,
  PersonFields,
  ReviewItem,
  ReviewKind,
} from './people.ts'

export interface RestStoreConfig {
  supabaseUrl: string
  serviceRoleKey: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A PostgREST `in.(...)` list with each value quoted, so commas and parentheses can't break it. */
function inList(values: string[]): string {
  const quoted = values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
  return encodeURIComponent(`(${quoted.join(',')})`)
}

/** Escape LIKE wildcards so a name is matched literally by `ilike`. */
function likeLiteral(text: string): string {
  return encodeURIComponent(text.replace(/[\\%_]/g, (c) => `\\${c}`))
}

const INTERACTION_COLUMNS = 'id,person_id,source,occurred_at,summary,direction,source_ref,created_at'

export function createRestPeopleStore(config: RestStoreConfig): PeopleStore {
  const base = `${config.supabaseUrl}/rest/v1`
  const headers = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    'Content-Type': 'application/json',
  }

  async function rest<T>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
    const { prefer, ...fetchInit } = init
    const res = await fetch(`${base}/${path}`, {
      ...fetchInit,
      headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
    })
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} failed: ${res.status} ${await res.text()}`)
    const text = await res.text()
    return (text ? JSON.parse(text) : []) as T
  }

  async function peopleByIds(ids: string[]): Promise<Person[]> {
    if (!ids.length) return []
    return rest<Person[]>(`people?id=in.${inList(ids)}&select=*`)
  }

  /** Owners of these (type, value) pairs in a table shaped like person_identifiers. */
  async function ownersOf(ids: { type: string; value: string }[]): Promise<string[]> {
    const byType = Map.groupBy(ids, (i) => i.type)
    const owners = new Set<string>()
    for (const [type, group] of byType) {
      const rows = await rest<{ person_id: string }[]>(
        `person_identifiers?type=eq.${type}&value=in.${inList(group.map((g) => g.value))}&select=person_id`,
      )
      for (const row of rows) owners.add(row.person_id)
    }
    return [...owners]
  }

  async function getPerson(id: string): Promise<Person | null> {
    if (!UUID.test(id)) return null
    const rows = await rest<Person[]>(`people?id=eq.${id}&select=*`)
    return rows[0] ?? null
  }

  return {
    personIdsByIdentifiers: ownersOf,

    async peopleByName(name) {
      const trimmed = name.trim()
      const byName = await rest<Person[]>(`people?name=ilike.${likeLiteral(trimmed)}&select=*`)
      const aliasOwners = await ownersOf([{ type: 'alias', value: trimmed.toLowerCase() }])
      const seen = new Set(byName.map((p) => p.id))
      const viaAlias = await peopleByIds(aliasOwners.filter((id) => !seen.has(id)))
      return [...byName, ...viaAlias]
    },

    getPerson,

    peopleByIds: (ids) => peopleByIds(ids.filter((id) => UUID.test(id))),

    async insertPerson(fields) {
      const rows = await rest<Person[]>('people', {
        method: 'POST',
        prefer: 'return=representation',
        body: JSON.stringify(fields),
      })
      return rows[0]
    },

    async updatePerson(id, fields: PersonFields) {
      if (!Object.keys(fields).length) {
        const existing = await getPerson(id)
        if (!existing) throw new Error(`no such person: ${id}`)
        return existing
      }
      const rows = await rest<Person[]>(`people?id=eq.${id}`, {
        method: 'PATCH',
        prefer: 'return=representation',
        body: JSON.stringify(fields),
      })
      if (!rows[0]) throw new Error(`no such person: ${id}`)
      return rows[0]
    },

    async addIdentifiers(personId, ids: Identifier[]) {
      if (!ids.length) return
      // on_conflict names the unique key: without it PostgREST only ignores primary-key clashes.
      await rest('person_identifiers?on_conflict=type,value', {
        method: 'POST',
        prefer: 'resolution=ignore-duplicates,return=minimal',
        body: JSON.stringify(ids.map((i) => ({ person_id: personId, ...i }))),
      })
    },

    async identifiersOf(personId) {
      return rest<Identifier[]>(`person_identifiers?person_id=eq.${personId}&select=type,value`)
    },

    async insertInteraction(row: NewInteraction) {
      try {
        const rows = await rest<Interaction[]>(`interactions?select=${INTERACTION_COLUMNS}`, {
          method: 'POST',
          prefer: 'return=representation',
          body: JSON.stringify(row),
        })
        return rows[0] ?? null
      } catch (err) {
        // The (source, source_ref) index is partial, so ON CONFLICT cannot name it: a clash
        // comes back as a unique violation, which here means "already stored".
        if (err instanceof Error && err.message.includes('"code":"23505"')) return null
        throw err
      }
    },

    async recentInteractions(personId, limit) {
      return rest<Interaction[]>(
        `interactions?person_id=eq.${personId}&select=${INTERACTION_COLUMNS}&order=occurred_at.desc&limit=${limit}`,
      )
    },

    async factsOf(personId) {
      return rest<Fact[]>(`person_facts?person_id=eq.${personId}&select=*&order=created_at.asc`)
    },

    async supersedeFact(factId, at) {
      await rest(`person_facts?id=eq.${factId}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: JSON.stringify({ superseded_at: at }),
      })
    },

    async insertFact(personId, key, value, sourceInteractionId) {
      const rows = await rest<Fact[]>('person_facts', {
        method: 'POST',
        prefer: 'return=representation',
        body: JSON.stringify({
          person_id: personId,
          key,
          value,
          ...(sourceInteractionId ? { source_interaction_id: sourceInteractionId } : {}),
        }),
      })
      return rows[0]
    },

    async getInteraction(id) {
      const rows = await rest<Interaction[]>(
        `interactions?id=eq.${encodeURIComponent(id)}&select=${INTERACTION_COLUMNS}&limit=1`,
      )
      return rows[0] ?? null
    },

    async deletePerson(id) {
      // Identifiers, interactions and facts go with them (ON DELETE CASCADE).
      await rest(`people?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' })
    },

    async addExclusions(entries: ExclusionEntry[]) {
      if (!entries.length) return
      await rest('person_exclusions?on_conflict=type,value', {
        method: 'POST',
        prefer: 'resolution=ignore-duplicates,return=minimal',
        body: JSON.stringify(entries),
      })
    },

    async anyExcluded(entries: ExclusionEntry[]) {
      const byType = Map.groupBy(entries, (e) => e.type)
      for (const [type, group] of byType) {
        const rows = await rest<{ id: string }[]>(
          `person_exclusions?type=eq.${type}&value=in.${inList(group.map((g) => g.value))}&select=id&limit=1`,
        )
        if (rows.length) return true
      }
      return false
    },

    async getSyncedAt(source) {
      const rows = await rest<{ last_synced_at: string }[]>(
        `sync_state?source=eq.${encodeURIComponent(source)}&select=last_synced_at`,
      )
      return rows[0]?.last_synced_at ?? null
    },

    async saveReviewItem(item: NewReviewItem) {
      // (kind, key) is a plain unique key, so a repeat merges into the existing item.
      const rows = await rest<ReviewItem[]>('review_items?on_conflict=kind,key', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=representation',
        body: JSON.stringify(item),
      })
      return rows[0]
    },

    async openReviewItems() {
      return rest<ReviewItem[]>('review_items?select=*&order=created_at.asc')
    },

    async getReviewItem(id) {
      if (!UUID.test(id)) return null
      const rows = await rest<ReviewItem[]>(`review_items?id=eq.${id}&select=*`)
      return rows[0] ?? null
    },

    async closeReviewItems(kind: ReviewKind, key: string) {
      await rest(`review_items?kind=eq.${kind}&key=eq.${encodeURIComponent(key)}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },

    async setSyncedAt(source, at) {
      await rest('sync_state', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: JSON.stringify({ source, last_synced_at: at }),
      })
    },
  }
}
