/**
 * The sensitive topics in parameters.md `avoid_topics`, as word stems. One list serves both the
 * Telegram bot (which refuses a note that touches one) and the Profile (which never shows the
 * summarizer an entry that touches one), so the two cannot drift apart. Keep in step with
 * `avoid_topics`.
 *
 * A stem matches the start of a word, so "worship" also catches "worshipping". Where a prefix
 * would misfire ("god" in "Godfather"), the stem ends at a word boundary.
 */

const MEDICAL = ['medic', 'doctor', 'diagnos', 'therap', 'surgery', 'cancer']

const TOPIC_STEMS: Record<string, string[]> = {
  health: ['health', ...MEDICAL],
  medical: MEDICAL,
  legal: ['legal', 'lawyer', 'attorney', 'lawsuit', 'sue[sd]?\\b'],
  financial: ['financ', 'debt', 'bankrupt'],
  religion: [
    'religio', 'church', 'worship', 'pray', 'bible', 'faith', 'sermon', 'baptis',
    'islam', 'muslim', 'christian', 'jewish', 'mosque', 'synagogue', 'god\\b',
  ],
}

export const SENSITIVE_TOPICS = Object.keys(TOPIC_STEMS)

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function matcher(stems: string[]): RegExp {
  return new RegExp(`\\b(?:${stems.join('|')})`, 'i')
}

const ANY_SENSITIVE = matcher([...new Set(Object.values(TOPIC_STEMS).flat())])

export function touchesSensitiveTopic(text: string): boolean {
  return ANY_SENSITIVE.test(text)
}

/**
 * True when the text touches one of the given topics. A topic is read by the known topic named
 * inside it ("legal matters" is legal), and always by its own words too, so a topic with no word
 * list still matches itself.
 */
export function touchesAvoidedTopic(text: string, topics: string[]): boolean {
  const stems = new Set<string>()
  for (const raw of topics) {
    const topic = raw.trim().toLowerCase()
    if (!topic) continue
    stems.add(escape(topic))
    for (const [known, list] of Object.entries(TOPIC_STEMS)) {
      if (topic.includes(known)) list.forEach((stem) => stems.add(stem))
    }
  }
  return stems.size > 0 && matcher([...stems]).test(text)
}

export function sensitiveTopicRefusal(): string {
  const named = `${SENSITIVE_TOPICS.slice(0, -1).join(', ')} or ${SENSITIVE_TOPICS[SENSITIVE_TOPICS.length - 1]}`
  return `Not saved: it touches a sensitive topic (${named}).`
}
