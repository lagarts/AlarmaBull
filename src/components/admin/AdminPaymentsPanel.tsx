import { listAdminPayments } from '../../data'
import type { AdminPaymentRow } from '../../data/types'
import { useAsync } from '../../hooks/useAsync'
import { formatAmountArs, formatDateTime } from '../../lib/datetime'
import { paymentStatusLabel } from '../subscription/labels'
import { Card, CardBody } from '../ui/Card'
import { EmptyState, ErrorState, Spinner } from '../ui/Feedback'

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

function shortUserId(payment: AdminPaymentRow): string {
  return payment.user_id ? payment.user_id.slice(0, 8) : '—'
}

export function AdminPaymentsPanel() {
  const paymentsQuery = useAsync<AdminPaymentRow[]>(() => listAdminPayments(), [])
  const payments = paymentsQuery.data ?? []

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-navy-900">Eventos de pago</h2>
          <span className="text-xs font-semibold text-navy-600">
            {payments.length} {payments.length === 1 ? 'evento' : 'eventos'}
          </span>
        </div>

        {paymentsQuery.loading ? (
          <Spinner label="Cargando eventos de pago…" />
        ) : paymentsQuery.error ? (
          <div className="mt-3">
            <ErrorState description={paymentsQuery.error} onRetry={paymentsQuery.reload} />
          </div>
        ) : payments.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="Todavía no hubo eventos de pago" />
          </div>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="hidden w-full text-left text-sm sm:table">
                <thead>
                  <tr className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Fecha
                    </th>
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Usuario
                    </th>
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Importe
                    </th>
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Estado
                    </th>
                    <th scope="col" className="py-2 font-semibold">
                      Referencia
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="py-2.5 pr-3 text-navy-600">
                        {formatDateTime(payment.created_at)}
                      </td>
                      <td className="py-2.5 pr-3 font-medium text-navy-900">
                        {shortUserId(payment)}
                      </td>
                      <td className="py-2.5 pr-3 font-semibold text-navy-900">
                        {amountLabel(payment)}
                      </td>
                      <td className="py-2.5 pr-3 text-navy-600">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            statusTone[payment.status] ?? 'bg-navy-100 text-navy-800'
                          }`}
                        >
                          {paymentStatusLabel(payment.status)}
                        </span>
                      </td>
                      <td className="py-2.5 text-navy-600">
                        {payment.provider_payment_id ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="mt-3 space-y-3 sm:hidden">
              {payments.map((payment) => (
                <li key={payment.id} className="rounded-xl border border-navy-100 bg-navy-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-navy-900">
                      {amountLabel(payment)}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        statusTone[payment.status] ?? 'bg-navy-100 text-navy-800'
                      }`}
                    >
                      {paymentStatusLabel(payment.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-navy-600">
                    {formatDateTime(payment.created_at)}
                  </p>
                  <p className="mt-0.5 text-xs text-navy-600">
                    Usuario: {shortUserId(payment)} · Referencia: {payment.provider_payment_id ?? '—'}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  )
}
