// supabase/functions/mercadopago-create/index.ts
//
// FASE 9/16 · Crea la suscripción mensual del usuario en Mercado Pago o,
// con {"action":"cancel"}, baja el débito automático (FASE 16).
//
// Producto elegido: Suscripciones (API de Preapproval) SIN plan asociado, con
// "pago pendiente": el medio de pago lo carga el comprador en el checkout
// alojado (init_point) y MP pasa a cobrar automáticamente todos los meses.
//
// URLs oficiales de Mercado Pago consultadas:
// - Resumen Suscripciones:
//   https://www.mercadopago.com.ar/developers/es/docs/subscriptions
// - Crear suscripción (POST /preapproval):
//   https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/create-preapproval/post
// - Suscripción sin plan asociado con pago pendiente (status "pending" + init_point):
//   https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments
// - Obtener suscripción (GET /preapproval/{id}):
//   https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/get-preapproval/get
// - Cancelar suscripción (PUT /preapproval/{id} con status):
//   https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/update-preapproval/put
//   https://www.mercadopago.com.ar/developers/es/docs/subscriptions/subscription-management
// - Credenciales (Access Token de prueba vs. de producción):
//   https://www.mercadopago.com.ar/developers/es/docs/subscriptions/additional-content/your-integrations/credentials
// - Webhooks de Suscripciones y firma x-signature:
//   https://www.mercadopago.com.ar/developers/es/docs/subscriptions/additional-content/your-integrations/notifications/webhooks
//   https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/payment-notifications
//
// Secretos usados (nunca se imprimen ni se devuelven al cliente):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   MP_ACCESS_TOKEN, APP_URL

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MP_CREATE_URL = "https://api.mercadopago.com/preapproval";

interface PlanRow {
  id: string;
  name: string;
  price_ars: number | string;
}

interface MpPreapprovalCreated {
  id?: string | number;
  init_point?: string;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Detecta el entorno a partir del Access Token (no se expone el token).
function detectEnvironment(token: string): "test" | "production" {
  return token.trim().startsWith("TEST-") ? "test" : "production";
}

function stripSlash(value: string): string {
  return value.replace(/\/+$/, "");
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
    const mpToken = Deno.env.get("MP_ACCESS_TOKEN");
    const appUrl = Deno.env.get("APP_URL");

    if (!supabaseUrl || !anonKey || !serviceKey || !mpToken || !appUrl) {
      return json({ error: "Configuración incompleta del servidor" }, 500);
    }

    // 1) Autenticación: el JWT del navegador define el usuario. Sin usuario → 401.
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    const user = authData?.user;
    if (authError || !user) {
      return json({ error: "No autorizado" }, 401);
    }

    // 2) Cliente con service role: única vía para leer/escribir estas tablas
    //    (RLS las bloquea desde el navegador). Nunca se devuelve al cliente.
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // 3) Cuentas suspendidas no pueden contratar. Se consulta con el propio
    //    JWT (RLS "profiles_select_self_or_admin"): el service role queda
    //    reservado para user_subscriptions y subscription_plans.
    const { data: profile } = await authClient
      .from("profiles")
      .select("suspended")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.suspended) {
      return json({ error: "Tu cuenta está suspendida. Comunicate con el administrador." }, 403);
    }

    // 3b) Cuerpo opcional: {"action":"cancel"} baja el débito automático
    //     (FASE 16). Sin action (o vacío) sigue siendo el alta de siempre.
    const rawBody = await req.text();
    let action = "";
    if (rawBody.trim()) {
      try {
        const parsed: unknown = JSON.parse(rawBody);
        if (typeof parsed === "object" && parsed !== null) {
          const value = (parsed as Record<string, unknown>).action;
          if (typeof value === "string") action = value.trim().toLowerCase();
        }
      } catch {
        return json({ error: "Cuerpo de la petición inválido" }, 400);
      }
      if (action !== "cancel") {
        return json({ error: "Acción no reconocida" }, 400);
      }
    }

    // 3c) Cancelación (FASE 16): PUT /preapproval/{id} con el estado "canceled".
    //     Sólo para suscripciones activas con vínculo en MP. Si el período pagado
    //     sigue vigente se respeta hasta el final (cancel_at_period_end); la
    //     webhook de MP confirma el mismo estado cuando notifica el cambio.
    if (action === "cancel") {
      const { data: subRow, error: subError } = await db
        .from("user_subscriptions")
        .select("id, status, current_period_end, provider, provider_subscription_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (subError) {
        console.error(`[mercadopago-create] error consultando la suscripción: ${subError.message}`);
        return json({ error: "No se pudo consultar la suscripción" }, 500);
      }
      const sub = subRow as {
        id: string;
        status: string;
        current_period_end: string | null;
        provider: string;
        provider_subscription_id: string | null;
      } | null;
      if (
        !sub ||
        sub.provider !== "mercadopago" ||
        !sub.provider_subscription_id ||
        sub.status !== "active"
      ) {
        return json({ error: "No hay ninguna suscripción activa para cancelar." }, 400);
      }

      const cancelUrl = `${MP_CREATE_URL}/${sub.provider_subscription_id}`;
      const putCancel = (statusValue: string) =>
        fetch(cancelUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${mpToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: statusValue }),
        });
      // La documentación de MP es inconsistente con la forma del valor
      // ("canceled" en el PUT, "cancelled" en las respuestas): si una forma
      // da 400 se reintenta con la otra.
      let cancelResponse = await putCancel("canceled");
      if (cancelResponse.status === 400) cancelResponse = await putCancel("cancelled");
      if (!cancelResponse.ok) {
        console.warn(`[mercadopago-create] cancelación rechazada por MP: ${cancelResponse.status}`);
        return json(
          { error: "No se pudo cancelar en Mercado Pago. Intentá de nuevo en unos minutos." },
          502,
        );
      }

      const periodEnd = sub.current_period_end ? new Date(sub.current_period_end).getTime() : 0;
      const cancelPatch: Record<string, unknown> =
        periodEnd > Date.now()
          ? { cancel_at_period_end: true }
          : { status: "canceled", cancel_at_period_end: false };
      cancelPatch.updated_at = new Date().toISOString();
      const { error: cancelSaveError } = await db
        .from("user_subscriptions")
        .update(cancelPatch)
        .eq("id", sub.id);
      if (cancelSaveError) {
        console.error(
          `[mercadopago-create] error guardando la cancelación: ${cancelSaveError.message}`,
        );
        return json({ error: "No se pudo registrar la cancelación" }, 500);
      }

      return json({
        canceled: true,
        cancel_at_period_end: cancelPatch.cancel_at_period_end === true,
      });
    }

    // 4) Plan activo y su precio real. Nunca se inventa ni se usa un monto por defecto.
    const { data: plans, error: planError } = await db
      .from("subscription_plans")
      .select("id, name, price_ars")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1);
    if (planError) {
      return json({ error: "No se pudo consultar el plan de suscripción" }, 500);
    }
    const plan: PlanRow | undefined = plans?.[0];
    if (!plan) {
      return json({ error: "No hay ningún plan activo. Contactá al administrador." }, 400);
    }
    const price = Number(plan.price_ars);
    if (!Number.isFinite(price) || price <= 0) {
      return json(
        { error: "El precio del plan todavía no fue configurado por el administrador" },
        400,
      );
    }
    if (!user.email) {
      return json({ error: "Tu cuenta de usuario no tiene un email asociado" }, 400);
    }

    // 5) Alta de la suscripción en Mercado Pago (POST /preapproval).
    //    No se envía preapproval_plan_id: los precios viven en subscription_plans.
    //    No se envía card_token_id / payment_profile_id / auto_cancel: el comprador
    //    autoriza la tarjeta dentro del checkout alojado de MP (init_point), por lo
    //    que no existe un medio de pago ni un perfil de pago guardado al crearla.
    //    status "pending" = modelo documentado de "suscripción sin plan asociado
    //    con pago pendiente".
    const baseUrl = stripSlash(appUrl);
    const notificationUrl = `${stripSlash(supabaseUrl)}/functions/v1/mercadopago-webhook`;

    const payload = {
      reason: plan.name,
      external_reference: user.id,
      payer_email: user.email,
      back_url: {
        success: `${baseUrl}/suscripcion?resultado=exito`,
        failure: `${baseUrl}/suscripcion?resultado=fallo`,
        pending: `${baseUrl}/suscripcion?resultado=pendiente`,
      },
      notification_url: notificationUrl,
      status: "pending",
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: price,
        currency_id: "ARS",
      },
    };

    const mpResponse = await fetch(MP_CREATE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const mpBody = (await mpResponse.json().catch(() => null)) as MpPreapprovalCreated | null;

    if (!mpResponse.ok || !mpBody?.id || !mpBody.init_point) {
      const detail = (mpBody as { message?: string } | null)?.message ?? "sin detalle";
      console.warn(`[mercadopago-create] Mercado Pago respondió ${mpResponse.status}: ${detail}`);
      return json(
        { error: "No se pudo crear la suscripción en Mercado Pago. Intentá nuevamente." },
        502,
      );
    }

    const preapprovalId = String(mpBody.id);

    // 6) Guardamos el vínculo. NO se cambia status: sólo un pago VERIFICADO
    //    server-side por mercadopago-webhook puede ponerla en 'active'.
    const { error: saveError } = await db.from("user_subscriptions").upsert(
      {
        user_id: user.id,
        plan_id: plan.id,
        provider: "mercadopago",
        provider_subscription_id: preapprovalId,
      },
      { onConflict: "user_id" },
    );
    if (saveError) {
      console.error(`[mercadopago-create] error guardando la suscripción: ${saveError.message}`);
      return json({ error: "No se pudo registrar la suscripción" }, 500);
    }

    return json({
      init_point: mpBody.init_point,
      preapproval_id: preapprovalId,
      environment: detectEnvironment(mpToken),
    });
  } catch {
    console.error("[mercadopago-create] error inesperado");
    return json({ error: "Error interno al procesar la suscripción" }, 500);
  }
});
