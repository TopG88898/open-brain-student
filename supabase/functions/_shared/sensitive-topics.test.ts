import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SENSITIVE_TOPICS, touchesAvoidedTopic, touchesSensitiveTopic } from './sensitive-topics.ts'

describe('touchesAvoidedTopic', () => {
  it('matches the words of a known topic named in the list, in any case', () => {
    assert.equal(touchesAvoidedTopic('Heading to Worship night', ['religion']), true)
    assert.equal(touchesAvoidedTopic('saw a doctor on Monday', ['medical']), true)
    assert.equal(touchesAvoidedTopic('hired a lawyer', ['legal']), true)
  })

  it('only looks for the topics it is given', () => {
    assert.equal(touchesAvoidedTopic('Heading to worship night', ['health', 'legal']), false)
    assert.equal(touchesAvoidedTopic('Heading to worship night', []), false)
  })

  it('reads a longer topic name by the known topic inside it', () => {
    assert.equal(touchesAvoidedTopic('legal trouble at work', ['legal matters']), true)
  })

  it('matches a topic it has no word list for by its own words', () => {
    assert.equal(touchesAvoidedTopic('argued about politics', ['politics']), true)
    assert.equal(touchesAvoidedTopic('argued about lunch', ['politics']), false)
  })

  it('lets health cover medical words, and ordinary text through', () => {
    assert.equal(touchesAvoidedTopic('a new medication', ['health']), true)
    assert.equal(touchesAvoidedTopic('moved to Denver', ['health', 'religion', 'legal']), false)
    assert.equal(touchesAvoidedTopic('goes to the Godfather screening', ['religion']), false)
  })
})

describe('financial topic', () => {
  it('catches everyday money talk, in any case', () => {
    assert.equal(touchesAvoidedTopic('sent the Invoice on Friday', ['financial']), true)
    assert.equal(touchesAvoidedTopic('she paid already', ['financial']), true)
    assert.equal(touchesAvoidedTopic('asked about pricing', ['financial']), true)
    assert.equal(touchesAvoidedTopic('negotiating a salary', ['financial']), true)
    assert.equal(touchesAvoidedTopic('applied for a loan', ['financial']), true)
    assert.equal(touchesAvoidedTopic('filing taxes this week', ['financial']), true)
    assert.equal(touchesAvoidedTopic('waiting on the bank', ['financial']), true)
  })

  it('lets lookalike words through', () => {
    assert.equal(touchesAvoidedTopic('grabbed a taxi to the airport', ['financial']), false)
    assert.equal(touchesAvoidedTopic('a taxonomy of birds', ['financial']), false)
  })

  it('flags money talk on the shared list the Telegram bot uses', () => {
    assert.equal(touchesSensitiveTopic('need to pay the invoice'), true)
  })
})

describe('the shared topic list', () => {
  it('names the five topics and flags any of them', () => {
    assert.deepEqual(SENSITIVE_TOPICS, ['health', 'medical', 'legal', 'financial', 'religion'])
    assert.equal(touchesSensitiveTopic('goes to church every Sunday'), true)
  })
})
