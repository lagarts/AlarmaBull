// supabase/functions/mercadopago-webhook/index.ts
//
// FASE 9 · Recibe las notificaciones de Mercado Pago (webhooks) y actualiza
// user_subscriptions / payment_events con el estado REAL consultado a la API
// de MP. Nunca se confía en el payload del navegador ni en el body del webhook.
//
// URLs oficiales de Mercado Pago consultadas:
// - Webhooks de Suscripciones (payload, query params, respuesta 200/201):
//   https://www.mercadopago.com.ar/developers/es/docs/subscriptions/additional-content/your-integrations/notifications/webhooks
// - Validación de la firma x-signature (manifest + HMAC-SHA256, sin SDK):
//   https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/payment-notifications
// - Obtener pago (GET /v1/payments/{id}) para el tópico payment:
//   https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/get-payment/get
// - Obtener suscripción (GET /preapproval/{id}) para el tópico preapproval:
//   https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/get-preapproval/get
// - Estados de la suscripción (authorized / paused / cancelled) y gestión:
//   https://www.mercadopago.com.ar/developers/es/docs/subscriptions/subscription-management
// - Crear suscripción (para contrastar amount / external_reference):
//   https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/create-preapproval/post
//
// Secretos usados (nunca se imprimen ni se devuelven):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET

import { createClient } from "npm:@supabase/supabase-js@2";

type Db = ReturnType<typeof createClient>;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MP_API = "https://api.mercadopago.com";

type EventStatus = "pending" | "approved" | "rejected" | "refunded" | "canceled";
type Topic = "payment" | "preapproval";

interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

interface MpPayment {
  id?: string | number;
  status?: string;
  transaction_amount?: number;
  currency_id?: string;
  external_reference?: string | null;
  preapproval_id?: string | null;
  date_created?: string;
  date_approved?: string | null;
}

interface MpPreapproval {
  id?: string | number;
  status?: string;
  external_reference?: string | null;
  next_payment_date?: string | null;
  auto_recurring?: {
    transaction_amount?: number;
    currency_id?: string;
    start_date?: string | null;
    end_date?: string | null;
  };
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------
// Firma oficial de Mercado Pago: x-signature = "ts=<ts>,v1=<v1>"
// manifest = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
// v1 = HMAC-SHA256(secret, manifest) en hexadecimal, comparación constante.
// ---------------------------------------------------------------
function parseXSignature(header: string): { ts: string; v1: string } | null {
  let ts = "";
  let v1 = "";
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "ts") ts = value;
    else if (key === "v1") v1 = value;
  }
  return ts && v1 ? { ts, v1 } : null;
}

function buildManifest(dataId: string, requestId: string, ts: string): string {
  const parts: string[] = [];
  if (dataId) parts.push(`id:${dataId}`);
  if (requestId) parts.push(`request-id:${requestId}`);
  parts.push(`ts:${ts}`);
  return `${parts.join(";")};`;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function isValidSignature(
  secret: string,
  xSignature: string,
  xRequestId: string,
  dataId: string,
): Promise<boolean> {
  const parsed = parseXSignature(xSignature);
  if (!parsed) return false;
  const manifest = buildManifest(dataId, xRequestId, parsed.ts);
  const computed = await hmacSha256Hex(secret, manifest);
  return constantTimeEquals(computed, parsed.v1);
}

// ---------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------
function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeTopic(rawTopic: string, action: string): Topic | "" {
  const value = (rawTopic || action.split(".")[0] || "").toLowerCase();
  if (value === "payment") return "payment";
  if (value === "preapproval" || value === "subscription_preapproval") return "preapproval";
  return "";
}

function mapPaymentStatus(status: string): EventStatus {
  switch (status.toLowerCase()) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "cancelled":
    case "canceled":
      return "canceled";
    case "refunded":
    case "charged_back":
      return "refunded";
    default:
      return "pending";
  }
}

function mapPreapprovalStatus(status: string): EventStatus {
  switch (status.toLowerCase()) {
    case "authorized":
      return "approved";
    case "cancelled":
    case "canceled":
      return "canceled";
    case "rejected":
      return "rejected";
    default:
      return "pending";
  }
}

function hasVigentPeriod(sub: SubscriptionRow): boolean {
  if (!sub.current_period_end) return false;
  return new Date(sub.current_period_end).getTime() > Date.now();
}

function amountMatches(amount: number, expected: number): boolean {
  if (!Number.isFinite(amount) || !Number.isFinite(expected)) return false;
  return Math.abs(amount - expected) <= 0.005;
}

function plusOneMonth(isoDate: string): string {
  const date = new Date(isoDate);
  const day = date.getUTCDate();
  date.setUTCMonth(date.getUTCMonth() + 1);
  if (date.getUTCDate() !== day) date.setUTCDate(0);
  return date.toISOString();
}

async function mpGet(token: string, path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${MP_API}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    console.warn(`[mercadopago-webhook] GET ${path} respondió ${response.status}`);
    throw new Error("mp_lookup_failed");
  }
  return (await response.json()) as Record<string, unknown>;
}

async function findSubscription(
  db: Db,
  userId: string,
  providerSubscriptionId: string,
): Promise<SubscriptionRow | null> {
  const columns =
    "id, user_id, plan_id, status, current_period_start, current_period_end, cancel_at_period_end";

  if (providerSubscriptionId) {
    const { data, error } = await db
      .from("user_subscriptions")
      .select(columns)
      .eq("provider_subscription_id", providerSubscriptionId)
      .maybeSingle();
    if (error) throw new Error("db_lookup_failed");
    if (data) return data as SubscriptionRow;
  }
  if (userId) {
    const { data, error } = await db
      .from("user_subscriptions")
      .select(columns)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error("db_lookup_failed");
    if (data) return data as SubscriptionRow;
  }
  return null;
}

async function getPlanPrice(db: Db, planId: string): Promise<number> {
  const { data, error } = await db
    .from("subscription_plans")
    .select("price_ars")
    .eq("id", planId)
    .maybeSingle();
  if (error) throw new Error("db_plan_failed");
  if (!data) return Number.NaN;
  return Number((data as { price_ars: number | string }).price_ars);
}

// Cancelación: sólo se da de baja cuando el período abonado termina.
function applyCancellation(
  sub: SubscriptionRow,
  preapproval: MpPreapproval,
  patch: Record<string, unknown>,
): void {
  const now = Date.now();
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end).getTime() : 0;
  const mpEndRaw = readString(preapproval.auto_recurring?.end_date);
  const mpEnd = mpEndRaw ? new Date(mpEndRaw).getTime() : 0;

  if (periodEnd > now) {
    patch.cancel_at_period_end = true;
    if (mpEnd && mpEnd <= now) {
      patch.status = "canceled";
      patch.cancel_at_period_end = false;
    }
    return;
  }
  if (mpEnd && mpEnd > now) {
    patch.cancel_at_period_end = true;
    return;
  }
  patch.status = "canceled";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Método no permitido" }, 405);
  }

  const webhookSecret = Deno.env.get("MP_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return json({ error: "MP_WEBHOOK_SECRET no está configurado" }, 500);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const mpToken = Deno.env.get("MP_ACCESS_TOKEN");
  if (!supabaseUrl || !serviceKey || !mpToken) {
    return json({ error: "Configuración incompleta del servidor" }, 500);
  }

  const url = new URL(req.url);
  const xSignature = req.headers.get("x-signature") ?? "";
  const xRequestId = req.headers.get("x-request-id") ?? "";
  if (!xSignature) {
    return json({ error: "Firma ausente" }, 401);
  }
  const signatureDataId = readString(url.searchParams.get("data.id")).toLowerCase();
  if (!(await isValidSignature(webhookSecret, xSignature, xRequestId, signatureDataId))) {
    console.warn("[mercadopago-webhook] firma inválida");
    return json({ error: "Firma inválida" }, 401);
  }

  const rawBody = await req.text();
  let body: Record<string, unknown> = {};
  if (rawBody) {
    try {
      const parsed: unknown = JSON.parse(rawBody);
      body = readObject(parsed) ?? {};
    } catch {
      return json({ error: "Cuerpo de la notificación inválido" }, 400);
    }
  }

  const bodyData = readObject(body.data);
  const action = readString(body.action);
  const topic = normalizeTopic(
    readString(url.searchParams.get("type")) ||
      readString(url.searchParams.get("topic")) ||
      readString(body.type),
    action,
  );
  const resourceId =
    readString(url.searchParams.get("data.id")) ||
    readString(url.searchParams.get("id")) ||
    readString(bodyData?.id) ||
    readString(body.id);

  if (!topic || !resourceId) {
    if (!resourceId) return json({ error: "Notificación sin identificador" }, 400);
    return json({ received: true, ignored: true, topic: readString(body.type) || "desconocido" }, 200);
  }

  const eventId = `${action || topic}:${resourceId}`;
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    // -----------------------------------------------------------
    // 1) Estado REAL consultado a la API de Mercado Pago (server-side).
    // -----------------------------------------------------------
    let subscription: SubscriptionRow | null = null;
    let expectedPrice = Number.NaN;
    let amount = Number.NaN;
    let currency = "";
    let eventStatus: EventStatus = "pending";
    let inconsistent = false;
    let patch: Record<string, unknown> = {};
    let providerSubscriptionId = "";

    if (topic === "payment") {
      const payment = (await mpGet(mpToken, `/v1/payments/${resourceId}`)) as unknown as MpPayment;

      const preapprovalId = readString(payment.preapproval_id);
      providerSubscriptionId = preapprovalId;
      let userId = readString(payment.external_reference);
      let linkedPreapproval: MpPreapproval | null = null;

      if (preapprovalId) {
        try {
          linkedPreapproval = (await mpGet(
            mpToken,
            `/preapproval/${preapprovalId}`,
          )) as unknown as MpPreapproval;
          if (!userId) userId = readString(linkedPreapproval.external_reference);
        } catch {
          console.warn("[mercadopago-webhook] no se pudo leer el preapproval asociado al pago");
        }
      }

      subscription = await findSubscription(db, userId, preapprovalId);
      if (!subscription) {
        console.warn(`[mercadopago-webhook] sin suscripción para payment ${resourceId}`);
        return json({ received: true, ignored: true }, 200);
      }

      expectedPrice = await getPlanPrice(db, subscription.plan_id);
      amount = Number(payment.transaction_amount);
      currency = readString(payment.currency_id).toUpperCase();
      eventStatus = mapPaymentStatus(readString(payment.status));
      inconsistent =
        !amountMatches(amount, expectedPrice) || (currency !== "" && currency !== "ARS");

      if (inconsistent) {
        console.warn(
          `[mercadopago-webhook] pago ${resourceId} inconsistente: monto=${amount} moneda=${currency} esperado=${expectedPrice}`,
        );
        eventStatus = "rejected";
      }

      if (!inconsistent && eventStatus === "approved") {
        // Período: lo informado por MP (next_payment_date = próxima cobranza)
        // y, si no lo informa, un mes desde la aprobación (billing_interval 'month').
        const startIso =
          readString(payment.date_approved) ||
          readString(payment.date_created) ||
          new Date().toISOString();
        const periodEnd = readString(linkedPreapproval?.next_payment_date) || plusOneMonth(startIso);
        patch = {
          status: "active",
          current_period_start: startIso,
          current_period_end: periodEnd,
          cancel_at_period_end: false,
          provider: "mercadopago",
        };
        if (providerSubscriptionId) patch.provider_subscription_id = providerSubscriptionId;
      } else if (!inconsistent && eventStatus === "rejected" && !hasVigentPeriod(subscription)) {
        patch = { status: "past_due" };
      }
    } else {
      const preapproval = (await mpGet(
        mpToken,
        `/preapproval/${resourceId}`,
      )) as unknown as MpPreapproval;

      providerSubscriptionId = readString(preapproval.id) || resourceId;
      const userId = readString(preapproval.external_reference);
      subscription = await findSubscription(db, userId, providerSubscriptionId);
      if (!subscription) {
        console.warn(`[mercadopago-webhook] sin suscripción para preapproval ${resourceId}`);
        return json({ received: true, ignored: true }, 200);
      }

      expectedPrice = await getPlanPrice(db, subscription.plan_id);
      amount = Number(preapproval.auto_recurring?.transaction_amount);
      currency = readString(preapproval.auto_recurring?.currency_id).toUpperCase();
      const mpStatus = readString(preapproval.status);
      eventStatus = mapPreapprovalStatus(mpStatus);
      inconsistent =
        !amountMatches(amount, expectedPrice) || (currency !== "" && currency !== "ARS");

      patch = { provider: "mercadopago", provider_subscription_id: providerSubscriptionId };

      if (inconsistent) {
        console.warn(
          `[mercadopago-webhook] preapproval ${resourceId} con monto inconsistente: ${amount} vs ${expectedPrice}`,
        );
        eventStatus = "rejected";
      } else if (mpStatus.toLowerCase() === "cancelled" || mpStatus.toLowerCase() === "canceled") {
        applyCancellation(subscription, preapproval, patch);
      } else if (mpStatus.toLowerCase() === "paused" && !hasVigentPeriod(subscription)) {
        // Pausada y sin período abonado vigente: no hay cobro garantizado.
        patch.status = "past_due";
      }
      // 'authorized' / 'pending' no activan por sí mismos: sólo un pago VERIFICADO
      // aprobado (tópico payment) pasa la suscripción a 'active'.
    }

    if (!subscription) {
      return json({ received: true, ignored: true }, 200);
    }

    // -----------------------------------------------------------
    // 2) Idempotencia: ON CONFLICT (provider_event_id) DO NOTHING.
    //    Si el evento ya existía se responde 200 sin reprocesar.
    //    currency usa el default de la columna (check: sólo ARS).
    // -----------------------------------------------------------
    const eventRow = {
      user_subscription_id: subscription.id,
      provider: "mercadopago",
      provider_payment_id: resourceId,
      event_type: action || topic,
      amount_ars: Number.isFinite(amount) ? round2(amount) : round2(expectedPrice || 0),
      status: eventStatus,
      provider_event_id: eventId,
    };

    const { data: inserted, error: insertError } = await db
      .from("payment_events")
      .upsert(eventRow, { onConflict: "provider_event_id", ignoreDuplicates: true })
      .select("id");

    if (insertError) {
      console.error(`[mercadopago-webhook] error registrando evento: ${insertError.message}`);
      return json({ error: "No se pudo registrar el evento" }, 502);
    }
    if (!inserted || inserted.length === 0) {
      return json({ received: true, duplicate: true }, 200);
    }
    const insertedId = (inserted[0] as { id: string }).id;

    // -----------------------------------------------------------
    // 3) Aplicar cambios a la suscripción y marcar el evento procesado.
    //    Si algo falla se revierte el evento para que MP pueda reintentar.
    // -----------------------------------------------------------
    try {
      if (Object.keys(patch).length > 0) {
        patch.updated_at = new Date().toISOString();
        const { error: updateError } = await db
          .from("user_subscriptions")
          .update(patch)
          .eq("id", subscription.id);
        if (updateError) throw new Error(updateError.message);
      }
      const { error: processedError } = await db
        .from("payment_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", insertedId);
      if (processedError) throw new Error(processedError.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      console.error(`[mercadopago-webhook] fallo al aplicar cambios: ${message}`);
      await db.from("payment_events").delete().eq("id", insertedId);
      return json({ error: "No se pudieron aplicar los cambios" }, 502);
    }

    return json({ received: true, event: eventId, status: eventStatus }, 200);
  } catch {
    console.error("[mercadopago-webhook] error procesando la notificación");
    return json({ error: "No se pudo procesar la notificación" }, 502);
  }
});
