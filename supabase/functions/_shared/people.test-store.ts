/**
 * In-memory PeopleStore for tests. It enforces the same rules the database does:
 * an identifier belongs to one person, (source, source_ref) is unique, and deleting a person
 * removes their identifiers, interactions and facts. Not imported by any deployed function.
 */

import type {
  ExclusionEntry,
  Fact,
  Identifier,
  Interaction,
  NewInteraction,
  PeopleStore,
  Person,
  PersonFields,
} from './people.ts'

const idKey = (i: { type: string; value: string }) => `${i.type}:${i.value}`

export function createMemoryStore(): PeopleStore {
  let seq = 0
  const nextId = () => `id-${++seq}`
  const stamp = () => new Date(2026, 8, 18, 12, 0, seq).toISOString()

  const people = new Map<string, Person>()
  const identifiers = new Map<string, string>() // "type:value" -> person id
  const interactions: (Interaction & { embedding: number[] | null })[] = []
  const facts: Fact[] = []
  const exclusions = new Set<string>()
  const syncedAt = new Map<string, string>()

  return {
    async personIdsByIdentifiers(ids) {
      const owners = ids.map((i) => identifiers.get(idKey(i))).filter((id): id is string => !!id)
      return [...new Set(owners)]
    },

    async peopleByName(name) {
      const wanted = name.trim().toLowerCase()
      return [...people.values()].filter((p) => {
        if (p.name.toLowerCase() === wanted) return true
        return [...identifiers].some(
          ([key, owner]) => owner === p.id && key === `alias:${wanted}`,
        )
      })
    },

    async getPerson(id) {
      return people.get(id) ?? null
    },

    async insertPerson(fields) {
      const person: Person = {
        id: nextId(),
        name: fields.name,
        status: fields.status ?? 'active',
        relationship: fields.relationship ?? null,
        profile_summary: fields.profile_summary ?? null,
        profile_updated_at: fields.profile_updated_at ?? null,
        last_contact_at: fields.last_contact_at ?? null,
        follow_up_at: fields.follow_up_at ?? null,
        follow_up_note: fields.follow_up_note ?? null,
        created_at: stamp(),
      }
      people.set(person.id, person)
      return person
    },

    async updatePerson(id, fields: PersonFields) {
      const existing = people.get(id)
      if (!existing) throw new Error(`no such person: ${id}`)
      const updated = { ...existing, ...fields }
      people.set(id, updated)
      return updated
    },

    async addIdentifiers(personId, ids: Identifier[]) {
      for (const i of ids) {
        const key = idKey(i)
        if (!identifiers.has(key)) identifiers.set(key, personId)
      }
    },

    async identifiersOf(personId) {
      return [...identifiers]
        .filter(([, owner]) => owner === personId)
        .map(([key]) => {
          const [type, ...rest] = key.split(':')
          return { type, value: rest.join(':') } as Identifier
        })
    },

    async insertInteraction(row: NewInteraction) {
      if (
        row.source_ref !== null &&
        interactions.some((i) => i.source === row.source && i.source_ref === row.source_ref)
      ) {
        return null
      }
      const interaction = { ...row, id: nextId(), created_at: stamp() }
      interactions.push(interaction)
      const { embedding: _dropped, ...publicShape } = interaction
      return publicShape
    },

    async recentInteractions(personId, limit) {
      return interactions
        .filter((i) => i.person_id === personId)
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
        .slice(0, limit)
        .map(({ embedding: _dropped, ...publicShape }) => publicShape)
    },

    async factsOf(personId) {
      return facts.filter((f) => f.person_id === personId)
    },

    async supersedeFact(factId, at) {
      const fact = facts.find((f) => f.id === factId)
      if (fact) fact.superseded_at = at
    },

    async insertFact(personId, key, value) {
      const fact: Fact = {
        id: nextId(),
        person_id: personId,
        key,
        value,
        superseded_at: null,
        created_at: stamp(),
      }
      facts.push(fact)
      return fact
    },

    async deletePerson(id) {
      people.delete(id)
      for (const [key, owner] of [...identifiers]) if (owner === id) identifiers.delete(key)
      for (let n = interactions.length - 1; n >= 0; n--) {
        if (interactions[n].person_id === id) interactions.splice(n, 1)
      }
      for (let n = facts.length - 1; n >= 0; n--) if (facts[n].person_id === id) facts.splice(n, 1)
    },

    async addExclusions(entries: ExclusionEntry[]) {
      for (const e of entries) exclusions.add(idKey(e))
    },

    async anyExcluded(entries: ExclusionEntry[]) {
      return entries.some((e) => exclusions.has(idKey(e)))
    },

    async getSyncedAt(source) {
      return syncedAt.get(source) ?? null
    },

    async setSyncedAt(source, at) {
      syncedAt.set(source, at)
    },
  }
}
