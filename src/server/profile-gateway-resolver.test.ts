import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveProfileGateway } from './profile-gateway-resolver'

describe('resolveProfileGateway', () => {
  let tempHome: string

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-workspace-profile-gateway-'))
    vi.stubEnv('HERMES_HOME', tempHome)
    vi.stubEnv('HERMES_API_URL', '')
    vi.stubEnv('CLAUDE_API_URL', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  it('resolves the default profile to the default Workspace gateway', async () => {
    const result = await resolveProfileGateway('default', {
      defaultGatewayBaseUrl: 'http://127.0.0.1:8642',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.profileName).toBe('default')
    expect(result.gatewayBaseUrl).toBe('http://127.0.0.1:8642')
    expect(result.healthStatus).toBe('unknown')
    expect(result.source).toBe('default-gateway')
  })

  it('resolves a named profile from an explicit Hermes API URL in profile .env', async () => {
    const profileRoot = path.join(tempHome, 'profiles', 'kay')
    fs.mkdirSync(profileRoot, { recursive: true })
    fs.writeFileSync(
      path.join(profileRoot, '.env'),
      [
        'HERMES_API_URL=http://127.0.0.1:8643',
        'OPENROUTER_API_KEY=must-not-be-returned',
      ].join('\n'),
      'utf-8',
    )

    const result = await resolveProfileGateway('kay')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.gatewayBaseUrl).toBe('http://127.0.0.1:8643')
    expect(result.source).toBe('profile-env-url')
    expect(JSON.stringify(result)).not.toContain('must-not-be-returned')
  })

  it('resolves a named profile from API_SERVER_PORT in profile .env', async () => {
    const profileRoot = path.join(tempHome, 'profiles', 'elle')
    fs.mkdirSync(profileRoot, { recursive: true })
    fs.writeFileSync(path.join(profileRoot, '.env'), 'API_SERVER_PORT=8644\n', 'utf-8')

    const result = await resolveProfileGateway('elle')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.gatewayBaseUrl).toBe('http://127.0.0.1:8644')
    expect(result.source).toBe('profile-env-port')
  })

  it('returns a clear error for a missing named profile without falling back to default', async () => {
    const result = await resolveProfileGateway('kay', {
      defaultGatewayBaseUrl: 'http://127.0.0.1:8642',
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.errorCode).toBe('PROFILE_NOT_FOUND')
    expect(result.profileName).toBe('kay')
    expect(JSON.stringify(result)).not.toContain('8642')
  })

  it('returns gateway-not-configured for a profile without gateway config and does not fall back', async () => {
    fs.mkdirSync(path.join(tempHome, 'profiles', 'emma'), { recursive: true })

    const result = await resolveProfileGateway('emma', {
      defaultGatewayBaseUrl: 'http://127.0.0.1:8642',
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.errorCode).toBe('GATEWAY_NOT_CONFIGURED')
    expect(result.profileName).toBe('emma')
    expect(JSON.stringify(result)).not.toContain('8642')
  })

  it('returns unreachable when health probing fails instead of falling back', async () => {
    const profileRoot = path.join(tempHome, 'profiles', 'kay')
    fs.mkdirSync(profileRoot, { recursive: true })
    fs.writeFileSync(path.join(profileRoot, '.env'), 'API_SERVER_PORT=8643\n', 'utf-8')
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }))

    const result = await resolveProfileGateway('kay', {
      checkHealth: true,
      fetchImpl: fetchMock,
      healthTimeoutMs: 50,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8643/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.errorCode).toBe('GATEWAY_UNREACHABLE')
    expect(result.gatewayBaseUrl).toBe('http://127.0.0.1:8643')
  })
})
