import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardBody, PageHeader } from '../components/ui/Card'
import { EmptyState, ErrorState, Notice, Spinner } from '../components/ui/Feedback'
import { AlertTriangleIcon, ArrowRightIcon, SirenIcon } from '../components/icons'
import { useAction, useAsync } from '../hooks/useAsync'
import { useMyCommunity, useSubscription } from '../hooks/useCommunity'
import { listAlerts, triggerAlert } from '../data'
import { dispatchAlertPush } from '../data/notifications'
import type { AlertRow, TriggerAlertResult } from '../data/types'
import { AlertListItem } from '../components/alarm/AlertListItem'
import { ConfirmDialog } from '../components/alarm/ConfirmDialog'
import { PrecautionDialog } from '../components/alarm/PrecautionDialog'
import { EmergencyContactsCard } from '../components/alarm/EmergencyContactsCard'
import { NoCommunityState } from '../components/alarm/NoCommunityState'
import { SubscriptionChip } from '../components/alarm/SubscriptionChip'
import { getCurrentCoords } from '../components/alarm/geolocation'
import { useAlertsRealtime } from '../components/alarm/useAlertsRealtime'

export function HomePage() {
  const communityState = useMyCommunity()
  const subscriptionState = useSubscription()
  const community = communityState.data
  const subscription = subscriptionState.data

  const alertsState = useAsync<AlertRow[] | null>(
    () => (community ? listAlerts(community.community_id, 5) : Promise.resolve(null)),
    [community?.community_id],
  )

  const sendAlert = useAction(
    (communityId: string, key: string, coords: { latitude: number; longitude: number } | null) =>
      triggerAlert(communityId, key, coords),
  )

  const sendPrecaution = useAction(
    (
      communityId: string,
      key: string,
      coords: { latitude: number; longitude: number } | null,
      message: string,
    ) => triggerAlert(communityId, key, coords, 'precaucion', message),
  )

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [noticeText, setNoticeText] = useState('')
  const [sendingNotice, setSendingNotice] = useState(false)
  const [result, setResult] = useState<TriggerAlertResult | null>(null)

  useAlertsRealtime(community?.community_id, alertsState.reload)

  const openConfirm = () => {
    setResult(null)
    sendAlert.clearError()
    setConfirmOpen(true)
  }

  const openNotice = () => {
    setResult(null)
    sendPrecaution.clearError()
    setNoticeOpen(true)
  }

  const handleConfirm = async () => {
    if (!community || sending) return
    setSending(true)
    try {
      // Una clave por intento: si se reintenta, el backend detecta el duplicado.
      const idempotencyKey = crypto.randomUUID()
      const coords = await getCurrentCoords()
      const sent = await sendAlert.run(community.community_id, idempotencyKey, coords)
      if (sent) {
        setResult(sent)
        alertsState.reload()
        if (!sent.duplicate) {
          // Dispara las notificaciones push a los vecinos (fire and forget).
          void dispatchAlertPush(sent.alert_id)
        }
      }
      setConfirmOpen(false)
    } finally {
      setSending(false)
    }
  }

  const handleNoticeConfirm = async () => {
    if (!community || sendingNotice) return
    const message = noticeText.trim()
    if (message.length < 3) return

    setSendingNotice(true)
    try {
      const idempotencyKey = crypto.randomUUID()
      const coords = await getCurrentCoords()
      const sent = await sendPrecaution.run(community.community_id, idempotencyKey, coords, message)
      if (sent) {
        setResult(sent)
        setNoticeText('')
        alertsState.reload()
        if (!sent.duplicate) {
          void dispatchAlertPush(sent.alert_id)
        }
      }
      setNoticeOpen(false)
    } finally {
      setSendingNotice(false)
    }
  }

  if (communityState.loading) return <Spinner label="Cargando tu comunidad…" />
  if (communityState.error) {
    return <ErrorState description={communityState.error} onRetry={communityState.reload} />
  }
  if (!community) return <NoCommunityState />

  const pendingMembership = community.my_status === 'pending'
  const activeMember = community.my_status === 'active' && community.status === 'active'
  const planOk = subscription?.status === 'active' || subscription?.status === 'trial'
  const canAlert = activeMember && planOk
  const memberCount = community.member_count
  const alerts = alertsState.data

  return (
    <div className="space-y-5">
      <PageHeader
        title={community.name}
        subtitle={`${memberCount} ${memberCount === 1 ? 'integrante' : 'integrantes'}`}
      />

      {subscription && <SubscriptionChip subscription={subscription} />}

      {pendingMembership && (
        <Notice tone="warning">Tu solicitud está pendiente de aprobación</Notice>
      )}

      {result && (
        <Notice tone={result.duplicate ? 'info' : 'success'}>
          {result.severity === 'precaucion'
            ? result.duplicate
              ? 'Este aviso ya se había enviado'
              : `Aviso enviado a ${result.recipients} ${result.recipients === 1 ? 'vecino' : 'vecinos'}`
            : result.duplicate
              ? 'Esta alerta ya se había enviado'
              : `Alerta enviada a ${result.recipients} ${result.recipients === 1 ? 'vecino' : 'vecinos'}`}
        </Notice>
      )}

      {(sendAlert.error || sendPrecaution.error) && (
        <Notice tone="danger">{sendAlert.error ?? sendPrecaution.error}</Notice>
      )}

      <Card>
        <CardBody className="space-y-4">
          <div>
            <h2 className="text-base font-bold text-navy-900">Botón de alarma</h2>
            <p className="mt-1 text-sm text-navy-600">
              Al activarlo, todos los vecinos activos de tu comunidad reciben la alerta al instante.
            </p>
          </div>

          <button
            type="button"
            onClick={openConfirm}
            disabled={!canAlert || sending || sendAlert.pending}
            aria-describedby={canAlert ? undefined : 'alarm-blocked-reason'}
            className="flex w-full items-center justify-center gap-3 rounded-3xl bg-av-red px-6 py-6 text-lg font-black tracking-wide text-white shadow-card transition-colors hover:bg-av-red-dark disabled:cursor-not-allowed disabled:bg-navy-200 disabled:text-navy-600"
          >
            <SirenIcon className="h-7 w-7" />
            ALERTA VECINAL
          </button>

          <button
            type="button"
            onClick={openNotice}
            disabled={!canAlert || sendingNotice || sendPrecaution.pending}
            aria-describedby={canAlert ? undefined : 'alarm-blocked-reason'}
            className="flex w-full items-center justify-center gap-3 rounded-3xl bg-av-yellow px-6 py-5 text-base font-black tracking-wide text-navy-900 shadow-card transition-colors hover:bg-av-yellow-dark disabled:cursor-not-allowed disabled:bg-navy-200 disabled:text-navy-600"
          >
            <AlertTriangleIcon className="h-6 w-6" />
            PRECAUCIÓN
          </button>

          <p className="text-xs text-navy-600">
            Para avisos que no son emergencias: escribís un mensaje y todos los vecinos lo
            reciben en su notificación.
          </p>

          {!canAlert && (
            <p id="alarm-blocked-reason" className="text-sm text-navy-600">
              {pendingMembership ? (
                'Vas a poder alertar cuando tu solicitud sea aprobada.'
              ) : !activeMember ? (
                'Esta comunidad no está activa, por eso no se pueden enviar alertas.'
              ) : (
                <>
                  Renová tu plan para activar alertas.{' '}
                  <Link
                    to="/suscripcion"
                    className="font-semibold text-av-blue underline underline-offset-2"
                  >
                    Ver suscripción
                  </Link>
                </>
              )}
            </p>
          )}
        </CardBody>
      </Card>

      <EmergencyContactsCard />

      <Card>
        <CardBody>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-navy-900">Últimas alertas</h2>
            <Link
              to="/alertas"
              className="inline-flex items-center gap-1 text-sm font-semibold text-av-blue hover:underline"
            >
              Ver todas
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-2">
            {alertsState.loading ? (
              <Spinner label="Cargando alertas…" />
            ) : alertsState.error ? (
              <ErrorState description={alertsState.error} onRetry={alertsState.reload} />
            ) : !alerts || alerts.length === 0 ? (
              <EmptyState title="Todavía no hubo alertas en tu comunidad" />
            ) : (
              <ul className="divide-y divide-navy-100">
                {alerts.map((alert) => (
                  <AlertListItem key={alert.id} alert={alert} relative />
                ))}
              </ul>
            )}
          </div>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Confirmar alerta vecinal"
        message="Vas a alertar a todos los vecinos de tu comunidad. ¿Confirmás?"
        confirmLabel="Sí, alertar"
        pending={sending}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />

      <PrecautionDialog
        open={noticeOpen}
        value={noticeText}
        pending={sendingNotice || sendPrecaution.pending}
        onChange={setNoticeText}
        onConfirm={handleNoticeConfirm}
        onCancel={() => setNoticeOpen(false)}
      />
    </div>
  )
}
