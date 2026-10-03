import { requireSupabase } from '../lib/supabase'
import { rpc, toAppError } from './client'
import type { CommunityMember, InviteRow, MyCommunity } from './types'

export function getMyCommunity(): Promise<MyCommunity | null> {
  return rpc<MyCommunity | null>('get_my_community')
}

export function createCommunity(name: string): Promise<string> {
  return rpc<string>('create_community', { p_name: name })
}

export function joinCommunity(token: string): Promise<string> {
  return rpc<string>('join_community', { p_token: token.trim() })
}

export function generateInvite(
  communityId: string,
  ttlSeconds: number,
  maxUses: number,
): Promise<string> {
  return rpc<string>('generate_invite', {
    p_community_id: communityId,
    p_ttl_seconds: ttlSeconds,
    p_max_uses: maxUses,
  })
}

export function revokeInvites(communityId: string): Promise<number> {
  return rpc<number>('revoke_invites', { p_community_id: communityId })
}

export function approveMember(memberId: string): Promise<void> {
  return rpc<void>('approve_member', { p_member_id: memberId })
}

export function removeMember(memberId: string): Promise<void> {
  return rpc<void>('remove_member', { p_member_id: memberId })
}

export async function listMembers(communityId: string): Promise<CommunityMember[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('community_members')
    .select(
      'id, user_id, role, membership_status, joined_at, profile:profiles(full_name, phone, suspended)',
    )
    .eq('community_id', communityId)
    .order('membership_status', { ascending: true })
    .order('joined_at', { ascending: true })
  if (error) throw toAppError(error)
  return (data ?? []) as unknown as CommunityMember[]
}

export async function listInvites(communityId: string): Promise<InviteRow[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('community_invites')
    .select('id, expires_at, revoked_at, max_uses, use_count, created_at, created_by')
    .eq('community_id', communityId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw toAppError(error)
  return (data ?? []) as InviteRow[]
}
