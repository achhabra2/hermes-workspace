import { BEARER_TOKEN } from './gateway-capabilities'
import type { ClaudeMessage, ClaudeSession } from './claude-api'

const _authHeaders = (): Record<string, string> =>
  BEARER_TOKEN ? { Authorization: `Bearer ${BEARER_TOKEN}` } : {}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

async function profileGet<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
    ...init,
    headers: { ..._authHeaders(), ...(init?.headers || {}) },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Profile Hermes API ${path}: ${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

async function profilePost<T>(
  baseUrl: string,
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
    ...init,
    method: 'POST',
    headers: {
      ..._authHeaders(),
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Profile Hermes API POST ${path}: ${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

export async function listProfileSessions(
  baseUrl: string,
  limit = 50,
  offset = 0,
): Promise<Array<ClaudeSession>> {
  const resp = await profileGet<{ items?: Array<ClaudeSession>; sessions?: Array<ClaudeSession> }>(
    baseUrl,
    `/api/sessions?limit=${limit}&offset=${offset}`,
  )
  return resp.items ?? resp.sessions ?? []
}

export async function createProfileSession(
  baseUrl: string,
  opts?: { id?: string; title?: string; model?: string },
): Promise<ClaudeSession> {
  const resp = await profilePost<{ session: ClaudeSession }>(
    baseUrl,
    '/api/sessions',
    opts || {},
  )
  return resp.session
}

export async function getProfileMessages(
  baseUrl: string,
  sessionId: string,
): Promise<Array<ClaudeMessage>> {
  const resp = await profileGet<{ items?: Array<ClaudeMessage>; messages?: Array<ClaudeMessage> }>(
    baseUrl,
    `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
  )
  return resp.items ?? resp.messages ?? []
}

type StreamChatOptions = {
  signal?: AbortSignal
  onEvent: (payload: {
    event: string
    data: Record<string, unknown>
  }) => void | Promise<void>
}

export async function streamProfileChat(
  baseUrl: string,
  sessionId: string,
  body: {
    message: string
    model?: string
    system_message?: string
    attachments?: Array<Record<string, unknown>>
  },
  opts: StreamChatOptions,
): Promise<void> {
  const res = await fetch(
    `${normalizeBaseUrl(baseUrl)}/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`,
    {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    },
  )

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Profile Hermes chat stream: ${res.status} ${text}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith('data: ')) {
        const dataStr = line.slice(6)
        if (dataStr === '[DONE]') continue
        try {
          const data = JSON.parse(dataStr) as Record<string, unknown>
          await opts.onEvent({ event: currentEvent || 'message', data })
        } catch {
          // skip malformed JSON
        }
      }
    }
  }
}
