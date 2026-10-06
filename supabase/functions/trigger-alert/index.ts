// supabase/functions/trigger-alert/index.ts
//
// FASE 7 · Web Push de la alerta vecinal.
//
// URLs oficiales de la documentación usada:
// - MDN · Push API (envío de notificaciones al navegador):
//   https://developer.mozilla.org/en-US/docs/Web/API/Push_API
// - MDN · Using the Push API · generar/claves VAPID (applicationServerKey):
//   https://developer.mozilla.org/en-US/docs/Web/API/Push_API/Using_the_Push_API
// - MDN · Notification API / ServiceWorkerRegistration.showNotification:
//   https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification
// - web-push (npm) · README, setVapidDetails y sendNotification:
//   https://github.com/web-push-libs/web-push#readme
// - web-push · API de opciones (TTL, headers):
//   https://github.com/web-push-libs/web-push#sendnotificationpushsubscription-payload-options
// - Supabase · Edge Functions secrets:
//   https://supabase.com/docs/guides/functions/secrets
// - Supabase · Invocar Edge Functions desde el cliente:
//   https://supabase.com/docs/guides/functions/functions-api
//
// Contrato: POST { alert_id: uuid } con el JWT del usuario en Authorization.
// Respuesta: { sent, failed } (200).
//
// Secretos usados (nunca se imprimen ni se devuelven al cliente):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opcional)

import { createClient } from "npm:@supabase/supabase-js@2";
import webPush from "npm:web-push@3.6.7";

type SupabaseClient = ReturnType<typeof createClient>;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DeliveryStatus = "sent" | "failed";

interface AlertRow {
  id: string;
  community_id: string;
  triggered_by: string;
  severity?: string | null;
  message?: string | null;
}

interface TriggererRow {
  full_name?: string | null;
  address?: string | null;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  subscription_data: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  } | null;
}

interface JobRow {
  id: string;
  status: string;
  attempts: number | null;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Error apto para logs/DB: nunca incluye endpoints, claves ni tokens. */
function safeErrorText(error: unknown): string {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof status === "number") return `web-push ${status}`;
  const name = error instanceof Error ? error.name : "";
  return name ? `error (${name})` : "error de envío";
}

function logError(context: string, error: unknown): void {
  console.error(`[trigger-alert] ${context}: ${safeErrorText(error)}`);
}

/** Recorta el cuerpo del push para que la notificación no quede gigante. */
function clipText(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Registra el resultado por destinatario en notification_jobs (idempotencia).
 * Reutiliza la fila placeholder que crea trigger_alert (push_subscription_id
 * null) y sólo actualiza; si no existe, inserta una fila nueva.
 */
async function recordJob(
  db: SupabaseClient,
  alertId: string,
  recipientUserId: string,
  subscriptionId: string,
  status: DeliveryStatus,
  lastError: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const patch = {
    status,
    last_error: lastError,
    sent_at: status === "sent" ? now : null,
    updated_at: now,
  };

  const { data: samePair } = await db
    .from("notification_jobs")
    .select("id, status, attempts")
    .eq("alert_id", alertId)
    .eq("recipient_user_id", recipientUserId)
    .eq("push_subscription_id", subscriptionId)
    .limit(1);

  const existing: JobRow | undefined = samePair?.[0];
  if (existing) {
    if (existing.status === "sent") return;
    await db
      .from("notification_jobs")
      .update({ ...patch, attempts: (existing.attempts ?? 0) + 1 })
      .eq("id", existing.id);
    return;
  }

  const { data: placeholder } = await db
    .from("notification_jobs")
    .select("id, status, attempts")
    .eq("alert_id", alertId)
    .eq("recipient_user_id", recipientUserId)
    .is("push_subscription_id", null)
    .neq("status", "sent")
    .limit(1);

  const slot: JobRow | undefined = placeholder?.[0];
  if (slot) {
    await db
      .from("notification_jobs")
      .update({ ...patch, push_subscription_id: subscriptionId, attempts: (slot.attempts ?? 0) + 1 })
      .eq("id", slot.id);
    return;
  }

  await db.from("notification_jobs").insert({
    alert_id: alertId,
    recipient_user_id: recipientUserId,
    push_subscription_id: subscriptionId,
    status,
    last_error: lastError,
    sent_at: status === "sent" ? now : null,
    attempts: 1,
  });
}

/** Verificación previa: ¿ese par (alerta, destinatario, suscripción) ya se envió? */
async function pairAlreadySent(
  db: SupabaseClient,
  alertId: string,
  recipientUserId: string,
  subscriptionId: string,
): Promise<boolean> {
  const { data } = await db
    .from("notification_jobs")
    .select("id")
    .eq("alert_id", alertId)
    .eq("recipient_user_id", recipientUserId)
    .eq("push_subscription_id", subscriptionId)
    .eq("status", "sent")
    .limit(1);
  return Boolean(data && data.length > 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Método no permitido" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: "Configuración incompleta del servidor" }, 500);
    }
    if (!vapidPublicKey || !vapidPrivateKey) {
      return json({ error: "Faltan secretos de push" }, 500);
    }

    // 1) El JWT del navegador define el usuario. Sin usuario → 401.
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    const user = authData?.user;
    if (authError || !user) {
      return json({ error: "No autorizado" }, 401);
    }

    // 2) Body: sólo { alert_id: uuid }.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Cuerpo inválido" }, 400);
    }
    const alertId = (body as { alert_id?: unknown } | null)?.alert_id;
    if (typeof alertId !== "string" || !UUID_RE.test(alertId)) {
      return json({ error: "alert_id inválido" }, 400);
    }

    // 3) Cliente con service role: única vía para leer estas tablas (RLS).
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: alert, error: alertError } = await db
      .from("alerts")
      .select("id, community_id, triggered_by, severity, message")
      .eq("id", alertId)
      .maybeSingle();
    if (alertError) {
      logError("consultando la alerta", alertError);
      return json({ error: "No se pudo consultar la alerta" }, 500);
    }
    if (!alert) {
      return json({ error: "Alerta no encontrada" }, 404);
    }
    const alertRow = alert as AlertRow;

    // Emisor de la alerta: nombre y dirección que cargó en el perfil.
    // La dirección se muestra en la lista de alertas y en la notificación.
    const { data: triggererData } = await db
      .from("profiles")
      .select("full_name, address")
      .eq("id", alertRow.triggered_by)
      .maybeSingle();
    const triggerer = (triggererData ?? null) as TriggererRow | null;

    // 4) El usuario debe ser integrante activo de la comunidad de la alerta.
    const { data: membership, error: membershipError } = await db
      .from("community_members")
      .select("user_id")
      .eq("community_id", alertRow.community_id)
      .eq("user_id", user.id)
      .eq("membership_status", "active")
      .maybeSingle();
    if (membershipError) {
      logError("verificando la membresía", membershipError);
      return json({ error: "No se pudo verificar la membresía" }, 500);
    }
    if (!membership) {
      return json({ error: "No autorizado" }, 403);
    }

    // 5) Destinatarios de la alerta y sus suscripciones activas.
    const { data: recipients, error: recipientsError } = await db
      .from("alert_recipients")
      .select("recipient_user_id")
      .eq("alert_id", alertId);
    if (recipientsError) {
      logError("consultando destinatarios", recipientsError);
      return json({ error: "No se pudieron consultar los destinatarios" }, 500);
    }

    const recipientIds = [...new Set((recipients ?? []).map((r: { recipient_user_id: string }) =>
      r.recipient_user_id,
    ))];
    if (recipientIds.length === 0) {
      return json({ sent: 0, failed: 0 });
    }

    const { data: subscriptions, error: subscriptionsError } = await db
      .from("push_subscriptions")
      .select("id, user_id, subscription_data")
      .in("user_id", recipientIds)
      .is("revoked_at", null);
    if (subscriptionsError) {
      logError("consultando suscripciones", subscriptionsError);
      return json({ error: "No se pudieron consultar las suscripciones" }, 500);
    }

    // 6) Envío Web Push con idempotencia por (alerta, destinatario, suscripción).
    //    El cuerpo lleva la dirección del emisor y, si es precaución, su mensaje.
    const subject = Deno.env.get("VAPID_SUBJECT") || supabaseUrl;
    const isPrecaution = alertRow.severity === "precaucion";
    const who = (triggerer?.full_name ?? "").trim();
    const where = (triggerer?.address ?? "").trim();

    let alertBody = "Un vecino disparó la alarma";
    if (where) {
      alertBody = `${who || "Un vecino"} · ${where}`;
    } else if (who) {
      alertBody = `${who} disparó la alarma`;
    }

    let precautionBody = alertRow.message ?? "Un vecino mandó un aviso de precaución";
    if (where) precautionBody = `${where} · ${precautionBody}`;

    const payload = JSON.stringify({
      title: isPrecaution ? "Precaución vecinal" : "¡Alerta vecinal!",
      body: clipText(isPrecaution ? precautionBody : alertBody),
      url: `/alertas/${alertId}`,
    });

    let sent = 0;
    let failed = 0;

    for (const recipientId of recipientIds) {
      const deviceSubs = (subscriptions ?? []).filter(
        (subscription: SubscriptionRow) => subscription.user_id === recipientId,
      );

      for (const subscription of deviceSubs) {
        const data = subscription.subscription_data;
        const endpoint = data?.endpoint;
        const p256dh = data?.keys?.p256dh;
        const auth = data?.keys?.auth;
        const subscriptionId = subscription.id;

        if (!endpoint || !p256dh || !auth) {
          failed += 1;
          await recordJob(db, alertId, recipientId, subscriptionId, "failed", "suscripción incompleta")
            .catch((error: unknown) => logError("registrando el job", error));
          continue;
        }

        if (await pairAlreadySent(db, alertId, recipientId, subscriptionId)) {
          continue;
        }

        try {
          await webPush.sendNotification(
            { endpoint, keys: { p256dh, auth } },
            payload,
            { vapidDetails: { subject, publicKey: vapidPublicKey, privateKey: vapidPrivateKey }, TTL: 43200 },
          );
          sent += 1;
          await recordJob(db, alertId, recipientId, subscriptionId, "sent", null)
            .catch((error: unknown) => logError("registrando el job", error));
        } catch (error) {
          failed += 1;
          logError("enviando el push", error);
          await recordJob(db, alertId, recipientId, subscriptionId, "failed", safeErrorText(error))
            .catch((writeError: unknown) => logError("registrando el job", writeError));
        }
      }
    }

    return json({ sent, failed });
  } catch (error) {
    logError("error inesperado", error);
    return json({ error: "Error interno al enviar las notificaciones" }, 500);
  }
});
