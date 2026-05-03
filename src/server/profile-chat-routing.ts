import {
  resolveProfileGateway,
  type ProfileGatewayResolutionError,
  type ResolveProfileGatewayOptions,
} from './profile-gateway-resolver'
import { resolveChatSessionProfile } from './chat-session-bindings'

export type ProfileChatRouteResolved = {
  ok: true
  profileName: string
  gatewayBaseUrl: string
  useProfileGateway: boolean
  source: 'session-binding' | 'request' | 'default'
}

export type ProfileChatRouteError = {
  ok: false
  status: number
  profileName: string
  gatewayBaseUrl?: string
  errorCode: ProfileGatewayResolutionError['errorCode']
  error: string
}

export type ProfileChatRouteResolution =
  | ProfileChatRouteResolved
  | ProfileChatRouteError

export type ResolveProfileChatRouteOptions = ResolveProfileGatewayOptions

function statusForProfileGatewayError(
  errorCode: ProfileGatewayResolutionError['errorCode'],
): number {
  if (errorCode === 'PROFILE_NOT_FOUND' || errorCode === 'INVALID_PROFILE_NAME') {
    return 404
  }
  if (errorCode === 'GATEWAY_UNREACHABLE') return 503
  return 400
}

export async function resolveProfileChatRoute(params: {
  sessionKey?: string | null
  requestedProfileName?: string | null
  resolverOptions?: ResolveProfileChatRouteOptions
}): Promise<ProfileChatRouteResolution> {
  const binding = resolveChatSessionProfile({
    sessionKey: params.sessionKey,
    requestedProfileName: params.requestedProfileName,
  })
  const profileName = binding.profileName
  const resolution = await resolveProfileGateway(profileName, {
    ...params.resolverOptions,
    checkHealth:
      params.resolverOptions?.checkHealth ?? profileName !== 'default',
  })

  if (resolution.ok === false) {
    return {
      ok: false,
      status: statusForProfileGatewayError(resolution.errorCode),
      profileName: resolution.profileName,
      gatewayBaseUrl: resolution.gatewayBaseUrl,
      errorCode: resolution.errorCode,
      error: resolution.error,
    }
  }

  return {
    ok: true,
    profileName: resolution.profileName,
    gatewayBaseUrl: resolution.gatewayBaseUrl,
    useProfileGateway: resolution.profileName !== 'default',
    source: binding.source,
  }
}
