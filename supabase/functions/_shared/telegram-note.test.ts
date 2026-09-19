import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isFromEthan, parsePersonNote, touchesSensitiveTopic } from './telegram-note.ts'

describe('parsePersonNote', () => {
  it('reads "@Name note" as a note about a one-word name', () => {
    assert.deepEqual(parsePersonNote('@Sarah moved to Denver'), { name: 'Sarah', note: 'moved to Denver' })
  })

  it('reads "@Full Name: note" as a note about a name with spaces', () => {
    assert.deepEqual(parsePersonNote('@Sarah Chen: moved to Denver'), {
      name: 'Sarah Chen',
      note: 'moved to Denver',
    })
  })

  it('does not take a later colon in the note for the end of the name', () => {
    assert.deepEqual(parsePersonNote('@Sarah moved to Denver, new address: 12 Main St'), {
      name: 'Sarah',
      note: 'moved to Denver, new address: 12 Main St',
    })
  })

  it('keeps a multi-line note whole', () => {
    assert.deepEqual(parsePersonNote('@Sarah Chen: line one\nline two'), {
      name: 'Sarah Chen',
      note: 'line one\nline two',
    })
  })

  it('ignores surrounding whitespace', () => {
    assert.deepEqual(parsePersonNote('  @Sarah   moved  '), { name: 'Sarah', note: 'moved' })
  })

  it('is not a person note without the prefix, so it stays a plain thought', () => {
    assert.equal(parsePersonNote('Sarah moved to Denver'), null)
    assert.equal(parsePersonNote('email me @ noon about it'), null)
  })

  it('is not a person note when there is nothing to note', () => {
    assert.equal(parsePersonNote('@Sarah'), null)
    assert.equal(parsePersonNote('@Sarah:   '), null)
    assert.equal(parsePersonNote('@ moved'), null)
  })
})

describe('touchesSensitiveTopic', () => {
  it('flags the sensitive topics, in any case and as word stems', () => {
    for (const text of [
      'she has a Health scare',
      'his medication changed',
      'seeing a medical specialist',
      'hired a lawyer, legal trouble',
      'money is tight, financial stress',
      'converted to Islam last year',
      'goes to church every Sunday',
      'active in a Bible study',
      'his faith matters a lot to him',
      'deeply religious family',
    ]) {
      assert.equal(touchesSensitiveTopic(text), true, text)
    }
  })

  it('lets ordinary notes through', () => {
    for (const text of [
      'moved to Denver',
      'new job at Acme',
      'loves hiking, has two kids',
      'goes to the Godfather screening on Friday',
      'studies at Temple University',
    ]) {
      assert.equal(touchesSensitiveTopic(text), false, text)
    }
  })
})

describe('isFromEthan', () => {
  const ok = { chatId: 42, secretHeader: 's3cret', allowedChatId: '42', expectedSecret: 's3cret' }

  it('accepts his chat with the right webhook secret', () => {
    assert.equal(isFromEthan(ok), true)
  })

  it('rejects any other chat', () => {
    assert.equal(isFromEthan({ ...ok, chatId: 43 }), false)
  })

  it('rejects a missing or wrong webhook secret', () => {
    assert.equal(isFromEthan({ ...ok, secretHeader: null }), false)
    assert.equal(isFromEthan({ ...ok, secretHeader: 'guess' }), false)
  })

  it('rejects everyone when either setting is missing, rather than letting everyone in', () => {
    assert.equal(isFromEthan({ ...ok, allowedChatId: undefined }), false)
    assert.equal(isFromEthan({ ...ok, expectedSecret: undefined }), false)
    assert.equal(isFromEthan({ ...ok, allowedChatId: '' }), false)
    assert.equal(isFromEthan({ ...ok, chatId: undefined }), false)
  })
})
