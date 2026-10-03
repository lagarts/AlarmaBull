import type { AdminPaymentRow } from '../../data/types'
import { formatAmountArs, formatDateTime } from '../../lib/datetime'
import { Card, CardBody } from '../ui/Card'
import { EmptyState } from '../ui/Feedback'
import { paymentStatusLabel } from './labels'

const statusTone: Record<string, string> = {
  approved: 'bg-green-100 text-green-800',
  pending: 'bg-orange-100 text-orange-800',
  rejected: 'bg-red-100 text-red-800',
  refunded: 'bg-navy-100 text-navy-800',
  canceled: 'bg-gray-200 text-gray-700',
}

function amountLabel(payment: AdminPaymentRow): string {
  return payment.amount_ars === null ? '—' : formatAmountArs(payment.amount_ars)
}

export function PaymentHistoryCard({ payments }: { payments: AdminPaymentRow[] }) {
  return (
    <Card>
      <CardBody>
        <h2 className="text-base font-bold text-navy-900">Historial de pagos</h2>

        {payments.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="Todavía no tenés pagos registrados." />
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-navy-100">
            {payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-navy-900">
                    {formatDateTime(payment.created_at)}
                  </p>
                  <p className="mt-0.5 text-xs text-navy-600">
                    Referencia: {payment.provider_payment_id ?? '—'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-navy-900">{amountLabel(payment)}</span>
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                      statusTone[payment.status] ?? 'bg-navy-100 text-navy-800'
                    }`}
                  >
                    {paymentStatusLabel(payment.status)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
