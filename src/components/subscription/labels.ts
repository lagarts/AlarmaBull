const subscriptionLabels: Record<string, string> = {
  trial: 'Prueba',
  active: 'Activa',
  past_due: 'Pago pendiente',
  expired: 'Vencida',
  canceled: 'Cancelada',
  none: 'Sin suscripción',
}

const paymentLabels: Record<string, string> = {
  approved: 'Aprobado',
  rejected: 'Rechazado',
  pending: 'Pendiente',
  refunded: 'Reembolsado',
  canceled: 'Cancelado',
}

export function subscriptionStatusLabel(status: string | null | undefined): string {
  if (!status) return subscriptionLabels.none
  return subscriptionLabels[status] ?? status
}

export function paymentStatusLabel(status: string): string {
  return paymentLabels[status] ?? status
}
