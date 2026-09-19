import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { createPeople, type Candidate, type People, type SuggestCriteria } from './people.ts'
import { createMemoryStore } from './people.test-store.ts'

let people: People

beforeEach(() => {
  people = createPeople({
    store: createMemoryStore(),
    now: () => new Date('2026-09-18T12:00:00Z'),
  })
})

describe('upsertPerson', () => {
  it('creates a person who can then be found by any identifier they were saved with', async () => {
    const created = await people.upsertPerson({
      name: 'Test Person',
      identifiers: [
        { type: 'phone', value: '(303) 555-0142' },
        { type: 'email', value: 'Test.Person@Example.com' },
      ],
    })
    assert.equal(created.status, 'created')

    const byPhone = await people.getPerson({ identifier: { type: 'phone', value: '+13035550142' } })
    const byEmail = await people.getPerson({
      identifier: { type: 'email', value: 'test.person@example.com' },
    })
    assert.equal(byPhone.status, 'found')
    assert.equal(byEmail.status, 'found')
  })

  it('files a newly created person as active', async () => {
    const created = await people.upsertPerson({ name: 'Test Person' })

    assert.equal(created.status === 'created' && created.person.status, 'active')
  })

  it('recognises the same phone number however it is written and attaches to the existing person', async () => {
    const first = await people.upsertPerson({
      name: 'Test Person',
      identifiers: [{ type: 'phone', value: '303-555-0142' }],
    })
    assert.equal(first.status, 'created')

    const second = await people.upsertPerson({
      identifiers: [
        { type: 'phone', value: '+1 (303) 555 0142' },
        { type: 'email', value: 'test@example.com' },
      ],
    })
    assert.equal(second.status, 'matched')
    if (first.status !== 'created' || second.status !== 'matched') return
    assert.equal(second.person.id, first.person.id)

    // The email that arrived with the match is now on the same file.
    const viaEmail = await people.getPerson({
      identifier: { type: 'email', value: 'test@example.com' },
    })
    assert.equal(viaEmail.status === 'found' && viaEmail.person.id, first.person.id)
  })

  it('never merges on a name alone: a same-name stranger comes back as a possible duplicate', async () => {
    await people.upsertPerson({
      name: 'Sarah Miller',
      identifiers: [{ type: 'phone', value: '303-555-0142' }],
    })

    const result = await people.upsertPerson({
      name: 'sarah miller',
      identifiers: [{ type: 'email', value: 'sarah@other-company.com' }],
    })

    assert.equal(result.status, 'possible_duplicate')
    if (result.status !== 'possible_duplicate') return
    assert.equal(result.candidates.length, 1)
    assert.equal(result.candidates[0].name, 'Sarah Miller')

    // Nothing was created: the new email points nowhere.
    const lookup = await people.getPerson({
      identifier: { type: 'email', value: 'sarah@other-company.com' },
    })
    assert.equal(lookup.status, 'not_found')
  })

  it('creates the second same-name person once the caller confirms they are different', async () => {
    await people.upsertPerson({
      name: 'Sarah Miller',
      identifiers: [{ type: 'phone', value: '303-555-0142' }],
    })

    const result = await people.upsertPerson({
      name: 'Sarah Miller',
      identifiers: [{ type: 'email', value: 'sarah@other-company.com' }],
      confirm_new: true,
    })

    assert.equal(result.status, 'created')
  })

  it('reports a conflict instead of merging when identifiers belong to two different people', async () => {
    const a = await people.upsertPerson({
      name: 'Alex Rivera',
      identifiers: [{ type: 'phone', value: '303-555-0111' }],
    })
    const b = await people.upsertPerson({
      name: 'Jordan Lee',
      identifiers: [{ type: 'email', value: 'jordan@example.com' }],
    })

    const result = await people.upsertPerson({
      identifiers: [
        { type: 'phone', value: '303-555-0111' },
        { type: 'email', value: 'jordan@example.com' },
      ],
    })

    assert.equal(result.status, 'conflict')
    if (result.status !== 'conflict' || a.status !== 'created' || b.status !== 'created') return
    assert.deepEqual(result.person_ids.sort(), [a.person.id, b.person.id].sort())
  })

  it('refuses to give a person an identifier that already belongs to someone else', async () => {
    await people.upsertPerson({
      name: 'Alex Rivera',
      identifiers: [{ type: 'phone', value: '303-555-0111' }],
    })
    const jordan = await people.upsertPerson({
      name: 'Jordan Lee',
      identifiers: [{ type: 'email', value: 'jordan@example.com' }],
    })
    if (jordan.status !== 'created') throw new Error('setup failed')

    const result = await people.upsertPerson({
      id: jordan.person.id,
      identifiers: [{ type: 'phone', value: '303-555-0111' }],
    })

    assert.equal(result.status, 'conflict')
  })

  it('updates the fields of a person addressed by id, including a follow-up', async () => {
    const created = await people.upsertPerson({ name: 'Test Person' })
    if (created.status !== 'created') throw new Error('setup failed')

    const updated = await people.upsertPerson({
      id: created.person.id,
      relationship: 'friend',
      follow_up_at: '2026-10-18T12:00:00Z',
      follow_up_note: 'ask how the move went',
    })

    assert.equal(updated.status, 'updated')
    if (updated.status !== 'updated') return
    assert.equal(updated.person.relationship, 'friend')
    assert.equal(updated.person.follow_up_note, 'ask how the move went')
  })
})

async function someone(name = 'Test Person') {
  const created = await people.upsertPerson({ name })
  if (created.status !== 'created') throw new Error('setup failed')
  return created.person
}

describe('addInteraction', () => {
  it('puts a note on the timeline where getPerson can read it back', async () => {
    const person = await someone()

    const result = await people.addInteraction({
      person_id: person.id,
      source: 'note',
      summary: 'Just moved to Denver; starts at Acme in October.',
    })
    assert.equal(result.status, 'added')

    const file = await people.getPerson({ id: person.id })
    assert.equal(file.status, 'found')
    if (file.status !== 'found') return
    assert.equal(file.interactions.length, 1)
    assert.match(file.interactions[0].summary, /Denver/)
  })

  it('stores the same source message only once', async () => {
    const person = await someone()
    const email = {
      person_id: person.id,
      source: 'email' as const,
      summary: 'Lease timing: she wants to sign by Oct 1.',
      source_ref: 'gmail-thread-abc123',
    }

    assert.equal((await people.addInteraction(email)).status, 'added')
    assert.equal((await people.addInteraction(email)).status, 'duplicate')

    const file = await people.getPerson({ id: person.id })
    assert.equal(file.status === 'found' && file.interactions.length, 1)
  })

  it('moves last contact forward for real contact but not for a note about them', async () => {
    const person = await someone()

    await people.addInteraction({
      person_id: person.id,
      source: 'imessage',
      summary: 'Confirmed dinner Friday.',
      occurred_at: '2026-09-10T18:00:00Z',
    })
    await people.addInteraction({
      person_id: person.id,
      source: 'note',
      summary: 'Remember: allergic to shellfish.',
      occurred_at: '2026-09-17T09:00:00Z',
    })

    const file = await people.getPerson({ id: person.id })
    assert.equal(file.status === 'found' && file.person.last_contact_at, '2026-09-10T18:00:00.000Z')
  })

  it('does not let an older message pull last contact backwards', async () => {
    const person = await someone()
    await people.addInteraction({
      person_id: person.id,
      source: 'email',
      summary: 'Recent thread.',
      occurred_at: '2026-09-15T10:00:00Z',
    })
    await people.addInteraction({
      person_id: person.id,
      source: 'email',
      summary: 'Older thread found on a later sync.',
      occurred_at: '2026-08-01T10:00:00Z',
    })

    const file = await people.getPerson({ id: person.id })
    assert.equal(file.status === 'found' && file.person.last_contact_at, '2026-09-15T10:00:00.000Z')
  })

  it('rejects an interaction for someone who has no file', async () => {
    await assert.rejects(
      people.addInteraction({ person_id: 'nobody', source: 'note', summary: 'Hello' }),
      /no such person/i,
    )
  })

  it('rejects an empty summary and an unknown source', async () => {
    const person = await someone()
    await assert.rejects(
      people.addInteraction({ person_id: person.id, source: 'note', summary: '   ' }),
      /summary/i,
    )
    await assert.rejects(
      people.addInteraction({ person_id: person.id, source: 'fax' as never, summary: 'Hi' }),
      /source/i,
    )
  })
})

describe('setFact', () => {
  it('keeps a corrected fact as history instead of deleting it', async () => {
    const person = await someone()
    await people.setFact(person.id, 'employer', 'Acme')

    const correction = await people.setFact(person.id, 'employer', 'Beacon')
    assert.equal(correction.status, 'set')

    const file = await people.getPerson({ id: person.id })
    if (file.status !== 'found') throw new Error('not found')
    assert.deepEqual(file.facts.active.map((f) => f.value), ['Beacon'])
    assert.deepEqual(file.facts.superseded.map((f) => f.value), ['Acme'])
  })

  it('does nothing when told a fact that is already recorded', async () => {
    const person = await someone()
    await people.setFact(person.id, 'employer', 'Acme')

    const again = await people.setFact(person.id, 'employer', 'Acme')

    assert.equal(again.status, 'unchanged')
    const file = await people.getPerson({ id: person.id })
    assert.equal(file.status === 'found' && file.facts.superseded.length, 0)
  })
})

describe('getPerson', () => {
  it('finds a person by name, and asks which one when two share it', async () => {
    const sarah = await someone('Sarah Miller')
    const found = await people.getPerson({ name: 'sarah miller' })
    assert.equal(found.status === 'found' && found.person.id, sarah.id)

    await people.upsertPerson({ name: 'Sarah Miller', confirm_new: true })
    const ambiguous = await people.getPerson({ name: 'Sarah Miller' })
    assert.equal(ambiguous.status, 'ambiguous')
  })

  it('says not_found for someone with no file', async () => {
    assert.equal((await people.getPerson({ name: 'Nobody' })).status, 'not_found')
  })
})

describe('forgetPerson', () => {
  it('asks for confirmation first and leaves the file untouched until it gets it', async () => {
    const person = await someone('Sarah Miller')
    await people.addInteraction({ person_id: person.id, source: 'note', summary: 'Likes hiking.' })

    const asked = await people.forgetPerson(person.id, { confirm: false })

    assert.equal(asked.status, 'confirmation_required')
    const file = await people.getPerson({ id: person.id })
    assert.equal(file.status === 'found' && file.interactions.length, 1)
  })

  it('wipes the whole file once confirmed', async () => {
    const created = await people.upsertPerson({
      name: 'Sarah Miller',
      identifiers: [{ type: 'phone', value: '303-555-0142' }],
    })
    if (created.status !== 'created') throw new Error('setup failed')
    await people.addInteraction({ person_id: created.person.id, source: 'note', summary: 'Likes hiking.' })
    await people.setFact(created.person.id, 'employer', 'Acme')

    const result = await people.forgetPerson(created.person.id, { confirm: true })

    assert.deepEqual(result, { status: 'forgotten', name: 'Sarah Miller' })
    assert.equal((await people.getPerson({ id: created.person.id })).status, 'not_found')
    assert.equal(
      (await people.getPerson({ identifier: { type: 'phone', value: '+13035550142' } })).status,
      'not_found',
    )
    await assert.rejects(
      people.addInteraction({ person_id: created.person.id, source: 'note', summary: 'Ghost' }),
      /no such person/i,
    )
  })

  it('will not recreate a forgotten person from the same phone number, however it is written', async () => {
    const created = await people.upsertPerson({
      name: 'Sarah Miller',
      identifiers: [{ type: 'phone', value: '303-555-0142' }],
    })
    if (created.status !== 'created') throw new Error('setup failed')
    await people.forgetPerson(created.person.id, { confirm: true })

    const again = await people.upsertPerson({
      name: 'Sarah',
      identifiers: [{ type: 'phone', value: '+1 303 555 0142' }],
    })

    assert.equal(again.status, 'excluded')
  })

  it('remembers a forgotten person who had no identifiers by their name', async () => {
    const person = await someone('Test Person')
    await people.forgetPerson(person.id, { confirm: true })

    assert.equal((await people.upsertPerson({ name: 'test person' })).status, 'excluded')
  })

  it('says not_found for someone with no file', async () => {
    assert.equal((await people.forgetPerson('nobody', { confirm: true })).status, 'not_found')
  })
})

describe('refreshProfile', () => {
  it('writes a profile from current facts and recent interactions, leaving out corrected claims', async () => {
    const person = await someone('Test Person')
    await people.setFact(person.id, 'employer', 'Acme')
    await people.setFact(person.id, 'employer', 'Beacon')
    await people.addInteraction({
      person_id: person.id,
      source: 'note',
      summary: 'Just moved to Denver.',
    })
    let prompt = ''

    const result = await people.refreshProfile(person.id, {
      summarize: async (p) => {
        prompt = p
        return '  Test Person recently moved to Denver and works at Beacon.  '
      },
      maxWords: 80,
      avoidTopics: ['health', 'legal matters'],
    })

    assert.deepEqual(result, {
      status: 'refreshed',
      summary: 'Test Person recently moved to Denver and works at Beacon.',
    })
    assert.match(prompt, /Beacon/)
    assert.match(prompt, /Denver/)
    assert.doesNotMatch(prompt, /Acme/)
    assert.match(prompt, /80 words/)
    assert.match(prompt, /health/)
    assert.match(prompt, /do not speculate/i)

    const file = await people.getPerson({ id: person.id })
    if (file.status !== 'found') throw new Error('not found')
    assert.equal(file.person.profile_summary, 'Test Person recently moved to Denver and works at Beacon.')
    assert.equal(file.person.profile_updated_at, '2026-09-18T12:00:00.000Z')
  })

  it('keeps the previous profile when the summarizer fails', async () => {
    const person = await someone('Test Person')
    await people.addInteraction({ person_id: person.id, source: 'note', summary: 'Likes hiking.' })
    await people.refreshProfile(person.id, { summarize: async () => 'Likes hiking.' })

    const result = await people.refreshProfile(person.id, {
      summarize: async () => {
        throw new Error('gateway down')
      },
    })

    assert.deepEqual(result, { status: 'failed', reason: 'gateway down' })
    const file = await people.getPerson({ id: person.id })
    assert.equal(file.status === 'found' && file.person.profile_summary, 'Likes hiking.')
  })
})

const CRITERIA = { min_messages: 6, min_each_way: 2, ignore_no_reply: true }

describe('suggestPeople', () => {
  it('suggests someone who clears the threshold, filed as suggested until approved', async () => {
    const [result] = await people.suggestPeople({
      candidates: [
        {
          name: 'Test Person',
          identifiers: [{ type: 'email', value: 'Test.Person@Example.com' }],
          sent: 4,
          received: 5,
        },
      ],
      criteria: CRITERIA,
    })

    assert.equal(result.status, 'suggested')
    const file = await people.getPerson({ identifier: { type: 'email', value: 'test.person@example.com' } })
    assert.equal(file.status === 'found' && file.person.status, 'suggested')
  })

  const scan = (c: Partial<Candidate> & { identifiers: Candidate['identifiers'] }) =>
    people.suggestPeople({
      candidates: [{ name: 'Test Person', sent: 4, received: 5, ...c }],
      criteria: CRITERIA,
    })

  it('skips someone with too few messages in total', async () => {
    const [result] = await scan({ identifiers: [{ type: 'phone', value: '303-555-0142' }], sent: 2, received: 3 })

    assert.deepEqual(result, { status: 'skipped', reason: 'below_threshold' })
  })

  it('skips a one-way sender however many messages they sent', async () => {
    const [result] = await scan({ identifiers: [{ type: 'email', value: 'a@example.com' }], sent: 0, received: 40 })

    assert.deepEqual(result, { status: 'skipped', reason: 'one_way' })
  })

  it('skips senders that look automated, whether or not the caller flagged them', async () => {
    const [byAddress] = await scan({ identifiers: [{ type: 'email', value: 'no-reply@shop.example.com' }] })
    const [byFlag] = await scan({ identifiers: [{ type: 'email', value: 'sam@shop.example.com' }], automated: true })

    assert.deepEqual(byAddress, { status: 'skipped', reason: 'automated' })
    assert.deepEqual(byFlag, { status: 'skipped', reason: 'automated' })
  })

  it('does not filter automated senders when the criteria say not to', async () => {
    const [result] = await people.suggestPeople({
      candidates: [
        { name: 'Shop', identifiers: [{ type: 'email', value: 'noreply@shop.example.com' }], sent: 4, received: 5 },
      ],
      criteria: { ...CRITERIA, ignore_no_reply: false },
    })

    assert.equal(result.status, 'suggested')
  })

  it('skips an excluded person and never files them', async () => {
    const someone = await people.upsertPerson({
      name: 'Gone Person',
      identifiers: [{ type: 'phone', value: '303-555-0199' }],
    })
    if (someone.status !== 'created') throw new Error('setup failed')
    await people.forgetPerson(someone.person.id, { confirm: true })

    const [result] = await scan({ identifiers: [{ type: 'phone', value: '(303) 555-0199' }] })

    assert.deepEqual(result, { status: 'skipped', reason: 'excluded' })
    const file = await people.getPerson({ identifier: { type: 'phone', value: '+13035550199' } })
    assert.equal(file.status, 'not_found')
  })

  it('skips an identifier it cannot read instead of failing the whole scan', async () => {
    const results = await people.suggestPeople({
      candidates: [
        { name: 'Short Code', identifiers: [{ type: 'phone', value: '22395' }], sent: 4, received: 5 },
        { name: 'Test Person', identifiers: [{ type: 'phone', value: '303-555-0142' }], sent: 4, received: 5 },
      ],
      criteria: CRITERIA,
    })

    assert.deepEqual(results[0], { status: 'skipped', reason: 'invalid_identifier' })
    assert.equal(results[1].status, 'suggested')
  })

  it('refuses to run without usable thresholds or counts, rather than suggesting everyone', async () => {
    const candidate = { name: 'Test Person', identifiers: [{ type: 'phone' as const, value: '303-555-0142' }] }

    await assert.rejects(
      people.suggestPeople({
        candidates: [{ ...candidate, sent: 4, received: 5 }],
        criteria: { ...CRITERIA, min_messages: Number.NaN },
      }),
      /min_messages/,
    )
    await assert.rejects(
      people.suggestPeople({
        candidates: [{ ...candidate, sent: undefined as unknown as number, received: 5 }],
        criteria: CRITERIA,
      }),
      /sent/,
    )
  })

  it('reports someone who already has a file, even when they are below the threshold', async () => {
    const existing = await people.upsertPerson({
      name: 'Test Person',
      identifiers: [{ type: 'phone', value: '303-555-0142' }],
    })
    if (existing.status !== 'created') throw new Error('setup failed')

    const [result] = await scan({
      identifiers: [{ type: 'phone', value: '(303) 555-0142' }, { type: 'email', value: 'tp@example.com' }],
      sent: 1,
      received: 0,
    })

    assert.equal(result.status, 'has_file')
    assert.equal(result.status === 'has_file' && result.person.id, existing.person.id)
    // The email seen in this scan now belongs to the same file.
    const viaEmail = await people.getPerson({ identifier: { type: 'email', value: 'tp@example.com' } })
    assert.equal(viaEmail.status === 'found' && viaEmail.person.id, existing.person.id)
  })

  it('does not suggest the same person twice', async () => {
    const [first] = await scan({ identifiers: [{ type: 'phone', value: '303-555-0142' }] })
    const [second] = await scan({ identifiers: [{ type: 'phone', value: '303-555-0142' }] })

    assert.equal(first.status, 'suggested')
    assert.equal(second.status, 'already_suggested')
    assert.equal(
      second.status === 'already_suggested' && first.status === 'suggested' && second.person.id,
      first.status === 'suggested' && first.person.id,
    )
  })

  it('reports identifiers that belong to two different files as a conflict, and merges nothing', async () => {
    const a = await people.upsertPerson({ name: 'Person A', identifiers: [{ type: 'phone', value: '303-555-0101' }] })
    const b = await people.upsertPerson({ name: 'Person B', identifiers: [{ type: 'email', value: 'b@example.com' }] })
    if (a.status !== 'created' || b.status !== 'created') throw new Error('setup failed')

    const [result] = await scan({
      identifiers: [{ type: 'phone', value: '303-555-0101' }, { type: 'email', value: 'b@example.com' }],
    })

    assert.equal(result.status, 'conflict')
    assert.deepEqual(
      result.status === 'conflict' && [...result.person_ids].sort(),
      [a.person.id, b.person.id].sort(),
    )
  })

  it('never merges on a name alone: a same-name stranger is a possible duplicate and nothing is filed', async () => {
    const existing = await people.upsertPerson({
      name: 'Test Person',
      identifiers: [{ type: 'phone', value: '303-555-0142' }],
    })
    if (existing.status !== 'created') throw new Error('setup failed')

    const [result] = await scan({ identifiers: [{ type: 'email', value: 'other@example.com' }] })

    assert.equal(result.status, 'possible_duplicate')
    assert.equal(
      result.status === 'possible_duplicate' && result.candidates[0].id,
      existing.person.id,
    )
    const stranger = await people.getPerson({ identifier: { type: 'email', value: 'other@example.com' } })
    assert.equal(stranger.status, 'not_found')
  })
})

describe('resolveSuggestion', () => {
  const suggest = async () => {
    const [result] = await people.suggestPeople({
      candidates: [
        { name: 'Test Person', identifiers: [{ type: 'phone', value: '303-555-0142' }], sent: 4, received: 5 },
      ],
      criteria: CRITERIA,
    })
    if (result.status !== 'suggested') throw new Error('setup failed')
    return result.person
  }

  it('approving gives the person an active file', async () => {
    const person = await suggest()

    const result = await people.resolveSuggestion(person.id, 'approve')

    assert.equal(result.status, 'approved')
    const file = await people.getPerson({ id: person.id })
    assert.equal(file.status === 'found' && file.person.status, 'active')
  })

  it('a dismissed person is never suggested again, but can still be approved later', async () => {
    const person = await suggest()
    const dismissed = await people.resolveSuggestion(person.id, 'dismiss')
    assert.equal(dismissed.status, 'dismissed')

    const [rescan] = await people.suggestPeople({
      candidates: [
        { name: 'Test Person', identifiers: [{ type: 'phone', value: '+13035550142' }], sent: 9, received: 9 },
      ],
      criteria: CRITERIA,
    })
    assert.deepEqual(rescan, { status: 'skipped', reason: 'dismissed' })

    const changedMind = await people.resolveSuggestion(person.id, 'approve')
    assert.equal(changedMind.status, 'approved')
  })

  it('never demotes someone who already has a file', async () => {
    const person = await suggest()
    await people.resolveSuggestion(person.id, 'approve')

    const result = await people.resolveSuggestion(person.id, 'dismiss')

    assert.equal(result.status, 'unchanged')
    const file = await people.getPerson({ id: person.id })
    assert.equal(file.status === 'found' && file.person.status, 'active')
  })

  it('says so when the person does not exist', async () => {
    assert.deepEqual(await people.resolveSuggestion('missing', 'approve'), { status: 'not_found' })
  })
})

describe('addInteraction for people without an approved file', () => {
  it('refuses to file anything under a suggested or dismissed person', async () => {
    const [suggested] = await people.suggestPeople({
      candidates: [
        { name: 'Test Person', identifiers: [{ type: 'phone', value: '303-555-0142' }], sent: 4, received: 5 },
      ],
      criteria: CRITERIA,
    })
    if (suggested.status !== 'suggested') throw new Error('setup failed')

    await assert.rejects(
      people.addInteraction({ person_id: suggested.person.id, source: 'imessage', summary: 'Made plans.' }),
      /not approved/,
    )

    await people.resolveSuggestion(suggested.person.id, 'dismiss')
    await assert.rejects(
      people.addInteraction({ person_id: suggested.person.id, source: 'note', summary: 'Made plans.' }),
      /not approved/,
    )

    await people.resolveSuggestion(suggested.person.id, 'approve')
    const added = await people.addInteraction({ person_id: suggested.person.id, source: 'imessage', summary: 'Made plans.' })
    assert.equal(added.status, 'added')
  })
})

describe('sync window', () => {
  it('the first sync looks back the configured number of days', async () => {
    const window = await people.startSync('email', { lookback_days: 30 })

    assert.deepEqual(window, { since: '2026-08-19T12:00:00.000Z' })
  })

  it('later syncs pick up where the last one finished, per source', async () => {
    await people.finishSync('email', '2026-09-17T08:00:00Z')

    assert.deepEqual(await people.startSync('email', { lookback_days: 30 }), { since: '2026-09-17T08:00:00.000Z' })
    assert.deepEqual(await people.startSync('imessage', { lookback_days: 30 }), { since: '2026-08-19T12:00:00.000Z' })
  })

  it('never moves the marker backwards', async () => {
    await people.finishSync('email', '2026-09-17T08:00:00Z')
    await people.finishSync('email', '2026-09-10T08:00:00Z')

    assert.deepEqual(await people.startSync('email', { lookback_days: 30 }), { since: '2026-09-17T08:00:00.000Z' })
  })

  it('meetings have their own marker', async () => {
    await people.finishSync('meeting', '2026-09-17T08:00:00Z')

    assert.deepEqual(await people.startSync('meeting', { lookback_days: 30 }), { since: '2026-09-17T08:00:00.000Z' })
    assert.deepEqual(await people.startSync('email', { lookback_days: 30 }), { since: '2026-08-19T12:00:00.000Z' })
  })

  it('only email, imessage and meeting can be synced', async () => {
    await assert.rejects(people.startSync('note', { lookback_days: 30 }), /cannot be synced/)
  })
})

describe('review queue', () => {
  const cand = (over: Partial<Candidate> = {}): Candidate => ({
    name: 'Test Person',
    identifiers: [{ type: 'email', value: 'test.person@example.com' }],
    sent: 4,
    received: 5,
    ...over,
  })
  const sweep = (candidates: Candidate[]) =>
    people.suggestPeople({ candidates, criteria: CRITERIA, queue: { source: 'email' } })

  it('holds a new suggestion for Ethan with who, where from, and how much they wrote', async () => {
    await sweep([cand()])

    const queue = await people.listReviewQueue()
    assert.equal(queue.count, 1)
    const [item] = queue.items
    assert.equal(item.kind, 'suggestion')
    assert.equal(item.subject, 'Test Person')
    assert.deepEqual(item.detail, {
      source: 'email',
      identifiers: [{ type: 'email', value: 'test.person@example.com' }],
      sent: 4,
      received: 5,
    })
  })

  it('queues nothing when the caller is a live conversation that will ask for approval itself', async () => {
    await people.suggestPeople({ candidates: [cand()], criteria: CRITERIA })

    assert.equal((await people.listReviewQueue()).count, 0)
  })

  it('does not queue the same person twice; a later sweep refreshes the counts', async () => {
    await sweep([cand()])
    await sweep([cand({ sent: 7, received: 9 })])

    const queue = await people.listReviewQueue()
    assert.equal(queue.count, 1)
    assert.equal(queue.items[0].detail.sent, 7)
    assert.equal(queue.items[0].detail.received, 9)
  })

  it('queues a possible duplicate and a conflict, each once, with the people involved', async () => {
    const a = await people.upsertPerson({ name: 'Person A', identifiers: [{ type: 'phone', value: '303-555-0101' }] })
    const b = await people.upsertPerson({ name: 'Person B', identifiers: [{ type: 'email', value: 'b@example.com' }] })
    const same = await people.upsertPerson({ name: 'Test Person', identifiers: [{ type: 'phone', value: '303-555-0142' }] })
    if (a.status !== 'created' || b.status !== 'created' || same.status !== 'created') throw new Error('setup failed')
    const conflicted = cand({
      name: 'Person A',
      identifiers: [{ type: 'phone', value: '303-555-0101' }, { type: 'email', value: 'b@example.com' }],
    })

    await sweep([cand(), conflicted])
    await sweep([cand(), conflicted])

    const { items } = await people.listReviewQueue()
    assert.deepEqual(items.map((i) => i.kind).sort(), ['conflict', 'possible_duplicate'])
    const duplicate = items.find((i) => i.kind === 'possible_duplicate')
    const conflict = items.find((i) => i.kind === 'conflict')
    assert.deepEqual(duplicate?.detail.candidate_ids, [same.person.id])
    assert.deepEqual([...(conflict?.detail.person_ids ?? [])].sort(), [a.person.id, b.person.id].sort())
  })

  it('never queues someone who is skipped, already has a file, or is excluded', async () => {
    const filed = await people.upsertPerson({ name: 'Filed Person', identifiers: [{ type: 'phone', value: '303-555-0177' }] })
    const gone = await people.upsertPerson({ name: 'Gone Person', identifiers: [{ type: 'phone', value: '303-555-0199' }] })
    if (filed.status !== 'created' || gone.status !== 'created') throw new Error('setup failed')
    await people.forgetPerson(gone.person.id, { confirm: true })
    const [dismissedResult] = await sweep([cand({ name: 'Turned Down', identifiers: [{ type: 'phone', value: '303-555-0155' }] })])
    if (dismissedResult.status !== 'suggested') throw new Error('setup failed')
    await people.resolveSuggestion(dismissedResult.person.id, 'dismiss')

    await sweep([
      cand({ name: 'Filed Person', identifiers: [{ type: 'phone', value: '303-555-0177' }] }),
      cand({ name: 'Gone Person', identifiers: [{ type: 'phone', value: '303-555-0199' }] }),
      cand({ name: 'Turned Down', identifiers: [{ type: 'phone', value: '303-555-0155' }] }),
      cand({ name: 'Quiet', identifiers: [{ type: 'phone', value: '303-555-0166' }], sent: 1, received: 1 }),
      cand({ name: 'Shop', identifiers: [{ type: 'email', value: 'noreply@shop.example.com' }] }),
    ])

    assert.equal((await people.listReviewQueue()).count, 0)
  })

  it('approving or dismissing a suggestion takes it off the queue', async () => {
    const [a, b] = await sweep([
      cand({ name: 'Person A', identifiers: [{ type: 'phone', value: '303-555-0101' }] }),
      cand({ name: 'Person B', identifiers: [{ type: 'phone', value: '303-555-0102' }] }),
    ])
    if (a.status !== 'suggested' || b.status !== 'suggested') throw new Error('setup failed')
    assert.equal((await people.listReviewQueue()).count, 2)

    await people.resolveSuggestion(a.person.id, 'approve')
    await people.resolveSuggestion(b.person.id, 'dismiss')

    assert.equal((await people.listReviewQueue()).count, 0)
  })

  it('forgetting a suggested person takes them off the queue', async () => {
    const [a] = await sweep([cand()])
    if (a.status !== 'suggested') throw new Error('setup failed')

    await people.forgetPerson(a.person.id, { confirm: true })

    assert.equal((await people.listReviewQueue()).count, 0)
  })

  it('closing a duplicate or conflict once Ethan has decided; suggestions must be approved or dismissed instead', async () => {
    const a = await people.upsertPerson({ name: 'Test Person', identifiers: [{ type: 'phone', value: '303-555-0142' }] })
    if (a.status !== 'created') throw new Error('setup failed')
    const [dup] = await sweep([cand()]).then(() => people.listReviewQueue()).then((q) => q.items)
    const [pending] = await sweep([cand({ name: 'Someone New', identifiers: [{ type: 'phone', value: '303-555-0188' }] })])
      .then(() => people.listReviewQueue())
      .then((q) => q.items.filter((i) => i.kind === 'suggestion'))

    await assert.rejects(people.closeReviewItem(pending.id), /approve or dismiss/)
    assert.deepEqual(await people.closeReviewItem(dup.id), { status: 'closed' })
    assert.deepEqual(await people.closeReviewItem('missing'), { status: 'not_found' })

    const left = await people.listReviewQueue()
    assert.deepEqual(left.items.map((i) => i.id), [pending.id])
  })
})

describe('suggestPeople from meetings', () => {
  const MEETING_CRITERIA = { ...CRITERIA, min_one_on_one_meetings: 1 }
  const meeting = (over: Partial<Candidate> = {}): Candidate => ({
    name: 'Test Person',
    identifiers: [{ type: 'email', value: 'test.person@example.com' }],
    meetings: { one_on_one: 1, group: 0 },
    ...over,
  })
  const scan = (candidates: Candidate[], criteria: SuggestCriteria = MEETING_CRITERIA, queue?: { source: string }) =>
    people.suggestPeople({ candidates, criteria, queue })

  it('suggests someone Ethan met one-on-one, with no message counts needed', async () => {
    const [result] = await scan([meeting()])

    assert.equal(result.status, 'suggested')
  })

  it('skips someone who only ever appeared in group meetings', async () => {
    const [result] = await scan([meeting({ meetings: { one_on_one: 0, group: 5 } })])

    assert.deepEqual(result, { status: 'skipped', reason: 'below_threshold' })
  })

  it('follows the configured number of one-on-ones', async () => {
    const criteria = { ...MEETING_CRITERIA, min_one_on_one_meetings: 2 }
    const [once] = await scan([meeting({ meetings: { one_on_one: 1, group: 3 } })], criteria)
    const [twice] = await scan([meeting({ meetings: { one_on_one: 2, group: 0 } })], criteria)

    assert.deepEqual(once, { status: 'skipped', reason: 'below_threshold' })
    assert.equal(twice.status, 'suggested')
  })

  it('skips a room or note-taker bot the caller flagged as automated', async () => {
    const [result] = await scan([meeting({ automated: true })])

    assert.deepEqual(result, { status: 'skipped', reason: 'automated' })
  })

  it('still reports someone who already has a file, even from a single group meeting', async () => {
    const existing = await people.upsertPerson({ name: 'Test Person', identifiers: [{ type: 'email', value: 'test.person@example.com' }] })
    if (existing.status !== 'created') throw new Error('setup failed')

    const [result] = await scan([meeting({ meetings: { one_on_one: 0, group: 1 } })])

    assert.equal(result.status === 'has_file' && result.person.id, existing.person.id)
  })

  it('leaves a meeting suggestion in the review queue with how often they met', async () => {
    await scan([meeting({ meetings: { one_on_one: 2, group: 3 } })], MEETING_CRITERIA, { source: 'meeting' })

    const [item] = (await people.listReviewQueue()).items
    assert.equal(item.detail.source, 'meeting')
    assert.deepEqual(item.detail.meetings, { one_on_one: 2, group: 3 })
  })

  it('refuses to run without a usable meeting threshold or counts, rather than suggesting everyone', async () => {
    await assert.rejects(scan([meeting()], CRITERIA), /min_one_on_one_meetings/)
    await assert.rejects(
      scan([meeting({ meetings: { one_on_one: undefined as unknown as number, group: 0 } })]),
      /one_on_one/,
    )
  })
})
