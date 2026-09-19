/**
 * Pure rules for the Telegram bot's people notes: who may talk to it, how a message says it is
 * a note about a person, and which notes are never saved. The bot (telegram-bot) wires these to
 * Telegram and the people module; nothing here touches the network or the database.
 */

export interface PersonNote {
  name: string
  note: string
}

const MAX_NAME_WORDS = 3

/**
 * "@Sarah moved to Denver" is a note about Sarah; "@Sarah Chen: moved to Denver" is one about
 * Sarah Chen. The colon only ends a name of up to three words, so a colon later in the note
 * ("@Sarah moved, new address: 12 Main St") is part of the note. Anything else is a plain thought.
 */
export function parsePersonNote(text: string): PersonNote | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('@')) return null

  const colon = trimmed.match(/^@([^:\n]+):([\s\S]*)$/)
  if (colon) {
    const name = colon[1].trim().split(/\s+/).join(' ')
    const note = colon[2].trim()
    if (name && note && name.split(' ').length <= MAX_NAME_WORDS) return { name, note }
  }

  const single = trimmed.match(/^@(\S+)\s+([\s\S]+)$/)
  if (single) return { name: single[1], note: single[2].trim() }
  return null
}

// The sensitive-topic rules live in sensitive-topics.ts, shared with the Profile.
export { SENSITIVE_TOPICS, sensitiveTopicRefusal, touchesSensitiveTopic } from './sensitive-topics.ts'

export interface CallerCheck {
  chatId: number | undefined
  /** The X-Telegram-Bot-Api-Secret-Token header, if Telegram sent one. */
  secretHeader: string | null
  /** Ethan's chat id, from the environment. */
  allowedChatId: string | undefined
  /** The secret the webhook was registered with, from the environment. */
  expectedSecret: string | undefined
}

/** Compares without stopping at the first difference, so timing does not leak the secret. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let n = 0; n < a.length; n++) diff |= a.charCodeAt(n) ^ b.charCodeAt(n)
  return diff === 0
}

/** True only for Ethan's own chat, delivered by the webhook he registered. Missing settings let nobody in. */
export function isFromEthan({ chatId, secretHeader, allowedChatId, expectedSecret }: CallerCheck): boolean {
  if (!allowedChatId || !expectedSecret || chatId === undefined || !secretHeader) return false
  return String(chatId) === allowedChatId && sameSecret(secretHeader, expectedSecret)
}
