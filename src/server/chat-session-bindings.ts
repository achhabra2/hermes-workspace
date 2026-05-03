import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type ChatSessionBinding = {
  profileName: string
  updatedAt: number
}

type StoreData = {
  bindings: Record<string, ChatSessionBinding>
}

const DATA_DIR = join(process.cwd(), '.runtime')
const BINDINGS_FILE = join(DATA_DIR, 'chat-session-bindings.json')
const DEFAULT_PROFILE = 'default'
const PROFILE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/
const BOOTSTRAP_SESSION_KEYS = new Set(['', 'main', 'new'])

let store: StoreData = { bindings: {} }

function loadFromDisk(): void {
  try {
    if (!existsSync(BINDINGS_FILE)) return
    const parsed = JSON.parse(readFileSync(BINDINGS_FILE, 'utf-8')) as StoreData
    if (parsed && typeof parsed === 'object' && parsed.bindings) {
      store = { bindings: parsed.bindings }
    }
  } catch {
    store = { bindings: {} }
  }
}

function saveToDisk(): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(BINDINGS_FILE, JSON.stringify(store, null, 2), 'utf-8')
  } catch {
    // Best-effort metadata cache; send-stream can still use request metadata.
  }
}

loadFromDisk()

export function normalizeProfileBinding(profileName?: string | null): string {
  const trimmed = typeof profileName === 'string' ? profileName.trim() : ''
  if (!trimmed || trimmed === DEFAULT_PROFILE) return DEFAULT_PROFILE
  if (!PROFILE_NAME_RE.test(trimmed)) return DEFAULT_PROFILE
  return trimmed
}

export function getChatSessionBinding(
  sessionKey?: string | null,
): ChatSessionBinding | null {
  const key = typeof sessionKey === 'string' ? sessionKey.trim() : ''
  if (!key) return null
  return store.bindings[key] ?? null
}

export function bindChatSessionToProfile(
  sessionKey: string | undefined | null,
  profileName: string | undefined | null,
): ChatSessionBinding | null {
  const key = typeof sessionKey === 'string' ? sessionKey.trim() : ''
  if (!key) return null
  const normalizedProfile = normalizeProfileBinding(profileName)
  const binding = { profileName: normalizedProfile, updatedAt: Date.now() }
  store.bindings[key] = binding
  saveToDisk()
  return binding
}

export function resolveChatSessionProfile(params: {
  sessionKey?: string | null
  requestedProfileName?: string | null
}): { profileName: string; source: 'session-binding' | 'request' | 'default' } {
  const key = typeof params.sessionKey === 'string' ? params.sessionKey.trim() : ''
  const existing = getChatSessionBinding(key)
  if (existing && !BOOTSTRAP_SESSION_KEYS.has(key)) {
    return { profileName: existing.profileName, source: 'session-binding' }
  }

  const requested = normalizeProfileBinding(params.requestedProfileName)
  if (requested !== DEFAULT_PROFILE) {
    return { profileName: requested, source: 'request' }
  }

  if (existing) return { profileName: existing.profileName, source: 'session-binding' }
  return { profileName: DEFAULT_PROFILE, source: 'default' }
}

export function resetChatSessionBindingsForTest(): void {
  store = { bindings: {} }
}
