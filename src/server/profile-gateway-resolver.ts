import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as YAML from 'yaml'

export type ProfileGatewaySource =
  | 'default-gateway'
  | 'workspace-env'
  | 'profile-config-url'
  | 'profile-config-port'
  | 'profile-env-url'
  | 'profile-env-port'

export type ProfileGatewayHealthStatus = 'unknown' | 'healthy' | 'unreachable'

export type ProfileGatewayErrorCode =
  | 'INVALID_PROFILE_NAME'
  | 'PROFILE_NOT_FOUND'
  | 'GATEWAY_NOT_CONFIGURED'
  | 'GATEWAY_UNREACHABLE'

export type ProfileGatewayResolved = {
  ok: true
  profileName: string
  profilePath: string
  gatewayBaseUrl: string
  source: ProfileGatewaySource
  healthStatus: ProfileGatewayHealthStatus
  model?: string
  provider?: string
}

export type ProfileGatewayResolutionError = {
  ok: false
  profileName: string
  profilePath?: string
  gatewayBaseUrl?: string
  source?: ProfileGatewaySource
  healthStatus: Exclude<ProfileGatewayHealthStatus, 'healthy'>
  errorCode: ProfileGatewayErrorCode
  error: string
  model?: string
  provider?: string
}

export type ProfileGatewayResolution =
  | ProfileGatewayResolved
  | ProfileGatewayResolutionError

export type ResolveProfileGatewayOptions = {
  hermesHome?: string
  defaultGatewayBaseUrl?: string
  checkHealth?: boolean
  fetchImpl?: typeof fetch
  healthTimeoutMs?: number
}

type GatewayCandidate = {
  gatewayBaseUrl: string
  source: ProfileGatewaySource
}

type ProfileMetadata = {
  model?: string
  provider?: string
}

const PROFILE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/
const URL_ENV_KEYS = ['HERMES_API_URL', 'CLAUDE_API_URL', 'API_SERVER_URL']
const PORT_ENV_KEYS = [
  'API_SERVER_PORT',
  'HERMES_API_PORT',
  'HERMES_GATEWAY_PORT',
  'CLAUDE_API_PORT',
]

function getHermesHome(options?: ResolveProfileGatewayOptions): string {
  return (
    options?.hermesHome ||
    process.env.HERMES_HOME ||
    process.env.CLAUDE_HOME ||
    path.join(os.homedir(), '.hermes')
  )
}

function normalizeProfileName(profileName: string | undefined): string {
  const trimmed = (profileName || '').trim()
  return trimmed || 'default'
}

function validateProfileName(profileName: string): boolean {
  return profileName === 'default' || PROFILE_NAME_RE.test(profileName)
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function defaultGatewayBaseUrl(options?: ResolveProfileGatewayOptions): string {
  return normalizeBaseUrl(
    options?.defaultGatewayBaseUrl ||
      process.env.HERMES_API_URL ||
      process.env.CLAUDE_API_URL ||
      'http://127.0.0.1:8642',
  )
}

function profilePathFor(hermesHome: string, profileName: string): string {
  return profileName === 'default'
    ? hermesHome
    : path.join(hermesHome, 'profiles', profileName)
}

function safeReadText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return ''
  }
}

function readYamlConfig(configPath: string): Record<string, unknown> {
  const raw = safeReadText(configPath)
  if (!raw) return {}
  try {
    const parsed = YAML.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function readConfigMetadata(config: Record<string, unknown>): ProfileMetadata {
  const metadata: ProfileMetadata = {}
  const model = config.model
  if (typeof model === 'string' && model.trim()) {
    metadata.model = model.trim()
  } else if (model && typeof model === 'object' && !Array.isArray(model)) {
    const modelConfig = model as Record<string, unknown>
    if (typeof modelConfig.default === 'string' && modelConfig.default.trim()) {
      metadata.model = modelConfig.default.trim()
    }
    if (typeof modelConfig.provider === 'string' && modelConfig.provider.trim()) {
      metadata.provider = modelConfig.provider.trim()
    }
  }
  if (!metadata.provider && typeof config.provider === 'string' && config.provider.trim()) {
    metadata.provider = config.provider.trim()
  }
  return metadata
}

function readNestedString(
  source: Record<string, unknown>,
  pathParts: Array<string>,
): string {
  let current: unknown = source
  for (const part of pathParts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return ''
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current.trim() : ''
}

function readNestedPort(
  source: Record<string, unknown>,
  pathParts: Array<string>,
): string {
  let current: unknown = source
  for (const part of pathParts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return ''
    current = (current as Record<string, unknown>)[part]
  }
  if (typeof current === 'number' && Number.isInteger(current)) return String(current)
  return typeof current === 'string' ? current.trim() : ''
}

function candidateFromConfig(config: Record<string, unknown>): GatewayCandidate | null {
  const url =
    readNestedString(config, ['workspace', 'gatewayUrl']) ||
    readNestedString(config, ['workspace', 'apiUrl']) ||
    readNestedString(config, ['gateway', 'url']) ||
    readNestedString(config, ['api', 'url']) ||
    readNestedString(config, ['hermesApiUrl']) ||
    readNestedString(config, ['claudeApiUrl'])
  if (url) {
    return { gatewayBaseUrl: normalizeBaseUrl(url), source: 'profile-config-url' }
  }

  const port =
    readNestedPort(config, ['workspace', 'gatewayPort']) ||
    readNestedPort(config, ['gateway', 'port']) ||
    readNestedPort(config, ['api', 'port']) ||
    readNestedPort(config, ['apiServerPort'])
  if (isValidPort(port)) {
    return { gatewayBaseUrl: `http://127.0.0.1:${port}`, source: 'profile-config-port' }
  }

  return null
}

function parseEnvAllowlist(envPath: string): Record<string, string> {
  const raw = safeReadText(envPath)
  const result: Record<string, string> = {}
  if (!raw) return result

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex <= 0) continue
    const key = trimmed.slice(0, equalsIndex).trim()
    if (!URL_ENV_KEYS.includes(key) && !PORT_ENV_KEYS.includes(key)) continue
    let value = trimmed.slice(equalsIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (value) result[key] = value
  }

  return result
}

function isValidPort(value: string): boolean {
  if (!/^\d+$/.test(value)) return false
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port <= 65535
}

function candidateFromEnv(envPath: string): GatewayCandidate | null {
  const env = parseEnvAllowlist(envPath)
  for (const key of URL_ENV_KEYS) {
    const value = env[key]
    if (value) {
      return { gatewayBaseUrl: normalizeBaseUrl(value), source: 'profile-env-url' }
    }
  }
  for (const key of PORT_ENV_KEYS) {
    const value = env[key]
    if (isValidPort(value)) {
      return { gatewayBaseUrl: `http://127.0.0.1:${value}`, source: 'profile-env-port' }
    }
  }
  return null
}

async function probeHealth(
  gatewayBaseUrl: string,
  options?: ResolveProfileGatewayOptions,
): Promise<boolean> {
  const fetchImpl = options?.fetchImpl || fetch
  const timeoutMs = options?.healthTimeoutMs ?? 3_000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(`${gatewayBaseUrl}/health`, {
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export async function resolveProfileGateway(
  profileNameInput?: string,
  options?: ResolveProfileGatewayOptions,
): Promise<ProfileGatewayResolution> {
  const profileName = normalizeProfileName(profileNameInput)
  if (!validateProfileName(profileName)) {
    return {
      ok: false,
      profileName,
      healthStatus: 'unknown',
      errorCode: 'INVALID_PROFILE_NAME',
      error: 'Invalid profile name',
    }
  }

  const hermesHome = getHermesHome(options)
  const profilePath = profilePathFor(hermesHome, profileName)
  if (!fs.existsSync(profilePath)) {
    return {
      ok: false,
      profileName,
      profilePath,
      healthStatus: 'unknown',
      errorCode: 'PROFILE_NOT_FOUND',
      error: `Profile "${profileName}" was not found`,
    }
  }

  const config = readYamlConfig(path.join(profilePath, 'config.yaml'))
  const metadata = readConfigMetadata(config)
  const candidate =
    profileName === 'default'
      ? {
          gatewayBaseUrl: defaultGatewayBaseUrl(options),
          source: (process.env.HERMES_API_URL || process.env.CLAUDE_API_URL
            ? 'workspace-env'
            : 'default-gateway') as ProfileGatewaySource,
        }
      : candidateFromConfig(config) || candidateFromEnv(path.join(profilePath, '.env'))

  if (!candidate) {
    return {
      ok: false,
      profileName,
      profilePath,
      healthStatus: 'unknown',
      errorCode: 'GATEWAY_NOT_CONFIGURED',
      error: `Gateway is not configured for profile "${profileName}"`,
      ...metadata,
    }
  }

  if (options?.checkHealth) {
    const healthy = await probeHealth(candidate.gatewayBaseUrl, options)
    if (!healthy) {
      return {
        ok: false,
        profileName,
        profilePath,
        gatewayBaseUrl: candidate.gatewayBaseUrl,
        source: candidate.source,
        healthStatus: 'unreachable',
        errorCode: 'GATEWAY_UNREACHABLE',
        error: `Gateway for profile "${profileName}" is unreachable`,
        ...metadata,
      }
    }
  }

  return {
    ok: true,
    profileName,
    profilePath,
    gatewayBaseUrl: candidate.gatewayBaseUrl,
    source: candidate.source,
    healthStatus: options?.checkHealth ? 'healthy' : 'unknown',
    ...metadata,
  }
}
