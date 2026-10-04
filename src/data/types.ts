export type SubscriptionStatus = 'none' | 'trial' | 'active' | 'past_due' | 'expired' | 'canceled'
export type MembershipStatus = 'pending' | 'active' | 'left' | 'removed'
export type CommunityRole = 'member' | 'admin'
export type AlertStatus = 'active' | 'resolved' | 'canceled'
export type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'
export type ServiceType = 'police' | 'fire' | 'ambulance'

export interface PlanInfo {
  id: string
  name: string
  price_ars: number
  trial_days: number
  features: string[]
}

export interface MySubscription {
  subscription_id: string | null
  status: SubscriptionStatus
  raw_status: SubscriptionStatus
  trial_started_at: string | null
  trial_ends_at: string | null
  trial_days_left: number | null
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  provider: 'manual' | 'mercadopago'
  plan: PlanInfo | null
}

export interface MyCommunity {
  community_id: string
  name: string
  status: string
  join_policy: string
  created_at: string
  created_by: string
  member_count: number
  pending_count: number
  my_member_id: string
  my_role: CommunityRole
  my_status: MembershipStatus
}

export interface CommunityMember {
  id: string
  user_id: string
  role: CommunityRole
  membership_status: MembershipStatus
  joined_at: string
  profile: { full_name: string | null; phone: string | null; suspended: boolean } | null
}

export interface InviteRow {
  id: string
  expires_at: string | null
  revoked_at: string | null
  max_uses: number
  use_count: number
  created_at: string
  created_by: string
}

export interface AlertRow {
  id: string
  community_id: string
  triggered_by: string
  created_at: string
  status: AlertStatus
  location_latitude: number | null
  location_longitude: number | null
  resolved_at: string | null
  triggerer: { full_name: string | null } | null
}

export interface AlertRecipientRow {
  id: string
  alert_id: string
  recipient_user_id: string
  delivery_status: DeliveryStatus
  delivered_at: string | null
  seen_at: string | null
  recipient: { full_name: string | null } | null
}

export interface TriggerAlertResult {
  alert_id: string
  duplicate: boolean
  recipients: number
}

export interface EmergencyContact {
  id: string
  country_code: string
  province: string | null
  locality: string | null
  service_type: ServiceType
  phone_number: string
  label: string | null
  source_url: string | null
  verified_at: string | null
}

export interface MyProfile {
  id: string
  full_name: string | null
  phone: string | null
  role: 'user' | 'admin_general'
  suspended: boolean
  suspended_reason: string | null
  created_at: string
}

export interface AdminMetrics {
  users_total: number
  users_suspended: number
  communities_total: number
  members_active: number
  alerts_last_30d: number
  subscriptions_trial: number
  subscriptions_active: number
  subscriptions_past_due: number
  subscriptions_expired: number
  revenue_month_ars: number
  [key: string]: number
}

export interface AdminUserRow {
  user_id: string
  full_name: string | null
  email: string | null
  suspended: boolean
  role: 'user' | 'admin_general'
  subscription_status: string | null
  trial_ends_at: string | null
  current_period_end: string | null
  created_at: string
}

export interface AdminPaymentRow {
  id: string
  provider: string
  provider_payment_id: string | null
  event_type: string
  amount_ars: number | null
  status: 'pending' | 'approved' | 'rejected' | 'refunded' | 'canceled'
  provider_event_id: string
  created_at: string
  user_id: string | null
}

export interface AppNotification {
  id: string
  title: string
  body: string | null
  read_at: string | null
  created_at: string
}
