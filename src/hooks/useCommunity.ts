import { useAsync } from './useAsync'
import { getMyCommunity, getMySubscription } from '../data'
import type { MyCommunity, MySubscription } from '../data/types'

export function useMyCommunity() {
  return useAsync<MyCommunity | null>(() => getMyCommunity(), [])
}

export function useSubscription() {
  return useAsync<MySubscription | null>(() => getMySubscription(), [])
}
