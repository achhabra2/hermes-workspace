import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, beforeEach } from 'vitest'
import { bindChatSessionToProfile, resetChatSessionBindingsForTest } from './chat-session-bindings'
import { resolveProfileChatRoute } from './profile-chat-routing'

function makeHermesHome(): string {
  const root = join(
    tmpdir(),
    `hermes-profile-chat-routing-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(join(root, 'profiles', 'kay'), { recursive: true })
  writeFileSync(join(root, 'config.yaml'), 'workspace:\n  gatewayUrl: http://127.0.0.1:8642\n')
  writeFileSync(
    join(root, 'profiles', 'kay', 'config.yaml'),
    'workspace:\n  gatewayUrl: http://127.0.0.1:8643\n',
  )
  return root
}

describe('profile chat routing', () => {
  beforeEach(() => {
    resetChatSessionBindingsForTest()
  })

  it('routes default sessions to the default gateway', async () => {
    const hermesHome = makeHermesHome()
    const route = await resolveProfileChatRoute({
      sessionKey: 'main',
      resolverOptions: { hermesHome, checkHealth: false },
    })

    expect(route).toMatchObject({
      ok: true,
      profileName: 'default',
      gatewayBaseUrl: 'http://127.0.0.1:8642',
      useProfileGateway: false,
      source: 'default',
    })
  })

  it('routes requested Kay chats to the Kay gateway', async () => {
    const hermesHome = makeHermesHome()
    const route = await resolveProfileChatRoute({
      sessionKey: 'new',
      requestedProfileName: 'kay',
      resolverOptions: { hermesHome, checkHealth: false },
    })

    expect(route).toMatchObject({
      ok: true,
      profileName: 'kay',
      gatewayBaseUrl: 'http://127.0.0.1:8643',
      useProfileGateway: true,
      source: 'request',
    })
  })

  it('keeps existing Kay-bound sessions on Kay when another profile is requested', async () => {
    const hermesHome = makeHermesHome()
    bindChatSessionToProfile('session-kay-bound', 'kay')

    const route = await resolveProfileChatRoute({
      sessionKey: 'session-kay-bound',
      requestedProfileName: 'default',
      resolverOptions: { hermesHome, checkHealth: false },
    })

    expect(route).toMatchObject({
      ok: true,
      profileName: 'kay',
      gatewayBaseUrl: 'http://127.0.0.1:8643',
      useProfileGateway: true,
      source: 'session-binding',
    })
  })

  it('returns profile errors instead of falling back to default', async () => {
    const hermesHome = makeHermesHome()
    const route = await resolveProfileChatRoute({
      sessionKey: 'new',
      requestedProfileName: 'missing-profile',
      resolverOptions: { hermesHome, checkHealth: false },
    })

    expect(route).toMatchObject({
      ok: false,
      status: 404,
      profileName: 'missing-profile',
      errorCode: 'PROFILE_NOT_FOUND',
    })
  })

  it('returns unreachable gateway errors instead of falling back to default', async () => {
    const hermesHome = makeHermesHome()
    const route = await resolveProfileChatRoute({
      sessionKey: 'new',
      requestedProfileName: 'kay',
      resolverOptions: {
        hermesHome,
        checkHealth: true,
        fetchImpl: async () => new Response(null, { status: 503 }),
      },
    })

    expect(route).toMatchObject({
      ok: false,
      status: 503,
      profileName: 'kay',
      gatewayBaseUrl: 'http://127.0.0.1:8643',
      errorCode: 'GATEWAY_UNREACHABLE',
    })
  })
})
