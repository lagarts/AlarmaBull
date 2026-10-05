// supabase/functions/estoy-bien-deliver/index.ts
//
// FASE 12 · Web Push del módulo "Estoy Bien".
//
// URLs oficiales de la documentación usada:
// - web-push (npm) · README, setVapidDetails y sendNotification:
//   https://github.com/web-push-libs/web-push#readme
// - MDN · Push API (envío de notificaciones al navegador):
//   https://developer.mozilla.org/en-US/docs/Web/API/Push_API
// - Supabase · Edge Functions secrets:
//   https://supabase.com/docs/guides/functions/secrets
// - Supabase · Invocar Edge Functions desde el cliente:
//   https://supabase.com/docs/guides/functions/functions-api
//
// Contrato: POST {} invocado por el cron con la service_role key en
// Authorization (procesa la cola de todos los usuarios) o por un usuario
// autenticado (procesa sólo sus recordatorios pendientes).
// Respuesta: { processed, sent, failed, skipped } (200).
//
// Secretos usados (nunca se imprimen ni se devuelven al cliente):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY,
//   VAPID_PRIVATE_KEY, VAPID_SUBJECT (opcional)

import { createClient } from "npm:@supabase/supabase-js@2";
import webPush from "npm:web-push@3.6.7";

type SupabaseClient = ReturnType<typeof createClient>;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 25;

interface ReminderRow {
  id: string;
  user_id: string;
  cycle_date: string;
  kind: string;
  title: string | null;
  body: string | null;
  url: string | null;
  attempts: number;
}

interface SubscriptionRow {
  user_id: string;
  subscription_data: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  } | null;
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
  console.error(`[estoy-bien-deliver] ${context}: ${safeErrorText(error)}`);
}

async function markReminder(
  db: SupabaseClient,
  reminder: ReminderRow,
  status: "sent" | "failed" | "skipped",
  lastError: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db
    .from("estoy_bien_reminders")
    .update({
      status,
      last_error: lastError,
      attempts: reminder.attempts + 1,
      sent_at: status === "sent" ? now : null,
      updated_at: now,
    })
    .eq("id", reminder.id);
  if (error) logError("registrando el resultado", error);
}

/** Si la persona ya confirmó el ciclo, los avisos de ese día ya no sirven. */
async function alreadyConfirmed(db: SupabaseClient, reminder: ReminderRow): Promise<boolean> {
  const { data } = await db
    .from("estoy_bien_checks")
    .select("id")
    .eq("user_id", reminder.user_id)
    .eq("cycle_date", reminder.cycle_date)
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

    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();

    // 1) Quién invoca: el cron manda el service_role key; el usuario manda su JWT.
    const isServiceCall = Boolean(bearer) && bearer === serviceKey;
    let callerId: string | null = null;

    if (!isServiceCall) {
      const probe = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: authData, error: authError } = await probe.auth.getUser();
      if (authError || !authData?.user) {
        return json({ error: "No autorizado" }, 401);
      }
      callerId = authData.user.id;
    }

    // 2) Cliente con service role: única vía para leer estas tablas (RLS).
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    let query = db
      .from("estoy_bien_reminders")
      .select("id, user_id, cycle_date, kind, title, body, url, attempts")
      .eq("channel", "push")
      .in("status", ["pending", "failed"])
      .lt("attempts", MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (callerId) {
      query = query.eq("user_id", callerId);
    }

    const { data: reminders, error: remindersError } = await query;
    if (remindersError) {
      logError("consultando recordatorios", remindersError);
      return json({ error: "No se pudieron consultar los recordatorios" }, 500);
    }

    const rows = (reminders ?? []) as ReminderRow[];
    if (rows.length === 0) {
      return json({ processed: 0, sent: 0, failed: 0, skipped: 0 });
    }

    const userIds = [...new Set(rows.map((row) => row.user_id))];

    const { data: subscriptions, error: subscriptionsError } = await db
      .from("push_subscriptions")
      .select("user_id, subscription_data")
      .in("user_id", userIds)
      .is("revoked_at", null);
    if (subscriptionsError) {
      logError("consultando suscripciones", subscriptionsError);
      return json({ error: "No se pudieron consultar las suscripciones" }, 500);
    }

    const subject = Deno.env.get("VAPID_SUBJECT") || supabaseUrl;

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const reminder of rows) {
      const deviceSubs = ((subscriptions ?? []) as SubscriptionRow[]).filter(
        (subscription) => subscription.user_id === reminder.user_id,
      );

      if (
        deviceSubs.length === 0 ||
        deviceSubs.every((subscription) => {
          const data = subscription.subscription_data;
          return !data?.endpoint || !data?.keys?.p256dh || !data?.keys?.auth;
        })
      ) {
        skipped += 1;
        await markReminder(db, reminder, "skipped", "sin dispositivos push registrados");
        continue;
      }

      // El aviso perdió vigencia: la persona ya confirmó ese ciclo.
      if (reminder.kind !== "resolved" && (await alreadyConfirmed(db, reminder))) {
        skipped += 1;
        await markReminder(db, reminder, "skipped", "usuario ya confirmó el ciclo");
        continue;
      }

      const payload = JSON.stringify({
        title: reminder.title ?? "Estoy Bien",
        body: reminder.body ?? "",
        url: reminder.url ?? "/estoy-bien",
      });

      let delivered = false;
      let lastError: string | null = null;

      for (const subscription of deviceSubs) {
        const data = subscription.subscription_data;
        const endpoint = data?.endpoint;
        const p256dh = data?.keys?.p256dh;
        const auth = data?.keys?.auth;
        if (!endpoint || !p256dh || !auth) continue;

        try {
          await webPush.sendNotification(
            { endpoint, keys: { p256dh, auth } },
            payload,
            {
              vapidDetails: { subject, publicKey: vapidPublicKey, privateKey: vapidPrivateKey },
              TTL: 43200,
            },
          );
          delivered = true;
        } catch (error) {
          lastError = safeErrorText(error);
          logError("enviando el push", error);
        }
      }

      if (delivered) {
        sent += 1;
        await markReminder(db, reminder, "sent", null);
      } else {
        failed += 1;
        await markReminder(db, reminder, "failed", lastError ?? "error de envío");
      }
    }

    return json({ processed: rows.length, sent, failed, skipped });
  } catch (error) {
    logError("error inesperado", error);
    return json({ error: "Error interno al enviar las notificaciones" }, 500);
  }
});
