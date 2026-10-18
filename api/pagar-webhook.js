import crypto from "crypto";
const TICKET_GENERATION_SECRET = process.env.TICKET_GENERATION_SECRET;


export const config = {
  api: {
    bodyParser: false
  }
};

function sendJson(res, status, data) {
  res.statusCode = status;

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  res.end(JSON.stringify(data));
}

function getHeader(req, name) {
  const value =
    req.headers?.[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value || "";
}

function timingSafeEqualString(a, b) {
  const aa = Buffer.from(
    String(a || ""),
    "utf8"
  );

  const bb = Buffer.from(
    String(b || ""),
    "utf8"
  );

  if (aa.length !== bb.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    aa,
    bb
  );
}

async function readRawBody(req) {
  const chunks = [];

  for await (
    const chunk of req
  ) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk)
    );
  }

  return Buffer.concat(chunks);
}

function verifyWebhookSignature(
  rawBody,
  signatureHeader,
  secret
) {
  if (
    !signatureHeader ||
    !secret
  ) {
    return false;
  }

  /*
   * Formato esperado:
   *
   * t=timestamp,v1=signature
   *
   * Também aceitamos múltiplos valores v1.
   */
  const parts =
    String(signatureHeader)
      .split(",");

  let timestamp = null;
  const signatures = [];

  for (const part of parts) {
    const index =
      part.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key =
      part
        .slice(0, index)
        .trim();

    const value =
      part
        .slice(index + 1)
        .trim();

    if (key === "t") {
      timestamp = value;
    }

    if (key === "v1") {
      signatures.push(value);
    }
  }

  if (
    !timestamp ||
    signatures.length === 0
  ) {
    return false;
  }

  const timestampNumber =
    Number(timestamp);

  if (
    !Number.isFinite(
      timestampNumber
    )
  ) {
    return false;
  }

  /*
   * Aceita somente timestamps recentes.
   */
  const now =
    Math.floor(
      Date.now() / 1000
    );

  const age =
    Math.abs(
      now - timestampNumber
    );

  if (age > 300) {
    return false;
  }

  /*
   * Assinatura:
   *
   * timestamp + "." + rawBody
   */
  const signedPayload =
    `${timestamp}.${rawBody.toString("utf8")}`;

  const expected =
    crypto
      .createHmac(
        "sha256",
        secret
      )
      .update(
        signedPayload
      )
      .digest("hex");

  for (
    const received of signatures
  ) {
    if (
      timingSafeEqualString(
        received,
        expected
      )
    ) {
      return true;
    }

    /*
     * Compatibilidade com header
     * eventualmente enviado como v1=...
     */
    if (
      timingSafeEqualString(
        received.replace(
          /^v1=/i,
          ""
        ),
        expected
      )
    ) {
      return true;
    }
  }

  return false;
}

function getSupabaseConfig() {
  const url =
    process.env.SUPABASE_URL;

  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !url ||
    !serviceRoleKey
  ) {
    throw new Error(
      "Configuração do Supabase não encontrada"
    );
  }

  return {
    url:
      url.replace(
        /\/+$/,
        ""
      ),

    key:
      serviceRoleKey
  };
}

async function supabaseRequest(
  path,
  options = {}
) {
  const {
    url,
    key
  } = getSupabaseConfig();

  const response =
    await fetch(
      `${url}${path}`,
      {
        ...options,

        headers: {
          "Content-Type":
            "application/json",

          "apikey":
            key,

          "Authorization":
            `Bearer ${key}`,

          ...(options.headers || {})
        }
      }
    );

  const text =
    await response.text();

  let data = null;

  if (text) {
    try {
      data =
        JSON.parse(text);
    } catch {
      data =
        text;
    }
  }

  if (!response.ok) {
    const error =
      new Error(
        data?.message ||
        data?.error ||
        text ||
        "Erro no Supabase"
      );

    error.status =
      response.status;

    error.data =
      data;

    throw error;
  }

  return data;
}

async function registerWebhookEvent(
  eventId,
  eventType,
  paymentId,
  payload
) {
  const rows =
    await supabaseRequest(
      "/rest/v1/pagar_webhook_events?on_conflict=event_id",
      {
        method: "POST",

        headers: {
          "Prefer":
            "return=representation,resolution=ignore-duplicates"
        },

        body:
          JSON.stringify({
            event_id:
              eventId,

            event_type:
              eventType ||
              null,

            payment_id:
              paymentId ||
              null,

            payload:
              payload
          })
      }
    );

  /*
   * Se veio uma linha, este evento é novo.
   * Se veio vazio, o evento já existia.
   */
  return {
    isNew:
      Array.isArray(rows) &&
      rows.length > 0,

    row:
      Array.isArray(rows)
        ? rows[0] || null
        : null
  };
}

async function claimWebhookEvent(eventId, token) {
  const result = await supabaseRequest(
    "/rest/v1/rpc/claim_pagar_webhook_event",
    {
      method: "POST",
      body: JSON.stringify({
        p_event_id: eventId,
        p_processing_token: token
      })
    }
  );

  return result === true;
}

async function markWebhookProcessed(eventId, token) {
  try {
    const rows = await supabaseRequest(
      "/rest/v1/pagar_webhook_events" +
        "?event_id=eq." + encodeURIComponent(eventId) +
        "&processing_token=eq." + encodeURIComponent(token) +
        "&processed_at=is.null",
      {
        method: "PATCH",
        headers: {
          "Prefer": "return=representation"
        },
        body: JSON.stringify({
          processed_at: new Date().toISOString(),
          processing_token: null,
          processing_started_at: null
        })
      }
    );

    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error("WEBHOOK_EVENT_FINISH_NOT_CONFIRMED");
    }
  } catch (error) {
    try {
      await releaseWebhookClaim(eventId, token);
    } catch (releaseError) {
      console.error(
        "PAGAR WEBHOOK CLAIM RELEASE ERROR:",
        releaseError.message
      );
    }

    throw error;
  }
}

async function releaseWebhookClaim(eventId, token) {
  await supabaseRequest(
    "/rest/v1/pagar_webhook_events" +
      "?event_id=eq." + encodeURIComponent(eventId) +
      "&processing_token=eq." + encodeURIComponent(token) +
      "&processed_at=is.null",
    {
      method: "PATCH",
      headers: {
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        processing_token: null,
        processing_started_at: null
      })
    }
  );
}

function getPaymentFromEvent(event) {
  if (
    event?.data?.payment
  ) {
    return event.data.payment;
  }

  if (
    event?.payment
  ) {
    return event.payment;
  }

  if (
    event?.data?.object
  ) {
    return event.data.object;
  }

  if (
    event?.data &&
    typeof event.data === "object"
  ) {
    return event.data;
  }

  return null;
}

function getPaymentId(payment) {
  return (
    payment?.id ||
    payment?.paymentId ||
    payment?.payment_id ||
    null
  );
}

function getPaymentReference(
  payment
) {
  return (
    payment?.reference ||
    payment?.paymentReference ||
    payment?.payment_reference ||
    null
  );
}

function getPaymentStatus(
  payment
) {
  return String(
    payment?.status ||
      ""
  )
    .trim()
    .toUpperCase();
}

async function markOrderPaid(
  payment
) {
  const reference =
    getPaymentReference(
      payment
    );

  const paymentId =
    getPaymentId(
      payment
    );

  if (!reference) {
    throw new Error(
      "PAYMENT_REFERENCE_MISSING"
    );
  }

  const rows =
    await supabaseRequest(
      `/rest/v1/blackout_orders?order_reference=eq.${encodeURIComponent(reference)}`,
      {
        method:
          "PATCH",

        headers: {
          "Prefer":
            "return=representation"
        },

        body:
          JSON.stringify({
            payment_status:
              "PAID",

            pagar_payment_id:
              paymentId,

            payment_reference:
              reference,

            paid_at:
              new Date().toISOString()
          })
      }
    );

  if (
    !Array.isArray(rows) ||
    rows.length === 0
  ) {
    throw new Error(
      "ORDER_NOT_FOUND"
    );
  }

  return rows[0];
}

async function markOrderFailed(
  payment
) {
  const reference =
    getPaymentReference(
      payment
    );

  if (!reference) {
    throw new Error(
      "PAYMENT_REFERENCE_MISSING"
    );
  }

  const rows =
    await supabaseRequest(
      `/rest/v1/blackout_orders?order_reference=eq.${encodeURIComponent(reference)}&payment_status=neq.PAID`,
      {
        method:
          "PATCH",

        headers: {
          "Prefer":
            "return=representation"
        },

        body:
          JSON.stringify({
            payment_status:
              "FAILED"
          })
      }
    );

  return (
    Array.isArray(rows) &&
    rows.length > 0
  );
}

async function generateTicket(
  order
) {
  /*
   * Mantemos a geração do bilhete através
   * da API existente.
   */
  const siteUrl =
    process.env.SITE_URL;

  if (!siteUrl) {
    throw new Error(
      "SITE_URL não configurado"
    );
  }

  const response =
    await fetch(
      `${siteUrl.replace(/\/+$/, "")}/api/generate-ticket`,
      {
        method:
          "POST",

        headers: {
  "Content-Type":
    "application/json",
  "x-ticket-generation-secret":
    TICKET_GENERATION_SECRET
},

        body:
          JSON.stringify({
            orderReference:
              order.order_reference
          })
      }
    );

  const text =
    await response.text();

  let data = null;

  if (text) {
    try {
      data =
        JSON.parse(text);
    } catch {
      data =
        text;
    }
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      "Falha ao gerar bilhete"
    );
  }

  return data;
}


async function processWalletTopup(payment) {
  const reference = getPaymentReference(payment);
  const paymentId = getPaymentId(payment);

  if (!reference) {
    throw new Error("PAYMENT_REFERENCE_MISSING");
  }

  if (!paymentId) {
    throw new Error("PAYMENT_ID_MISSING");
  }

  if (!String(reference).startsWith("BAR-TOPUP-")) {
    return { handled: false };
  }

  // Aceitar apenas o campo documentado pelo Pagar.
  const rawAmount = payment?.amountMzn;

  if (
    rawAmount === null ||
    rawAmount === undefined ||
    String(rawAmount).trim() === ""
  ) {
    throw new Error("PAYMENT_AMOUNT_MISSING");
  }

  const amountMzn = Number(rawAmount);

  if (!Number.isFinite(amountMzn) || amountMzn <= 0) {
    throw new Error("PAYMENT_AMOUNT_INVALID");
  }

  const currency = String(payment?.currency || "")
    .trim()
    .toUpperCase();

  if (currency !== "MZN") {
    throw new Error("PAYMENT_CURRENCY_INVALID");
  }

  const result = await supabaseRequest(
    "/rest/v1/rpc/process_wallet_topup_payment_v2",
    {
      method: "POST",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        p_payment_reference: reference,
        p_payment_id: String(paymentId),
        p_amount_mzn: amountMzn,
        p_currency: currency,
        p_description:
          `Recarga confirmada pelo Pagar — ${reference}`
      })
    }
  );

  return {
    handled: true,
    result
  };
}

async function processPaymentSucceeded(
  payment
) {
  const reference =
    getPaymentReference(
      payment
    );

  const paymentId =
    getPaymentId(
      payment
    );

  /*
   * ------------------------------------------------------------
   * WALLET TOPUP
   * ------------------------------------------------------------
   */
  if (
    String(
      reference || ""
    ).startsWith(
      "BAR-TOPUP-"
    )
  ) {
    return processWalletTopup(
      payment
    );
  }

  /*
   * ------------------------------------------------------------
   * TICKET ORDER
   * ------------------------------------------------------------
   */
  const order =
    await markOrderPaid(
      payment
    );

  return {
    handled:
      true,

    type:
      "TICKET",

    order,
    ticket_generation: "QUEUED",

    payment_id:
      paymentId
  };
}

async function processPaymentFailed(
  payment
) {
  const reference =
    getPaymentReference(
      payment
    );

  /*
   * Recarga de carteira.
   */
  if (
    String(
      reference || ""
    ).startsWith(
      "BAR-TOPUP-"
    )
  ) {
    /*
     * A recarga continua registrada,
     * mas passa a FAILED e não é creditada.
     */
    const rows =
      await supabaseRequest(
        `/rest/v1/wallet_topups?payment_reference=eq.${encodeURIComponent(reference)}&payment_status=eq.PENDING`,
        {
          method:
            "PATCH",

          headers: {
            "Prefer":
              "return=representation"
          },

          body:
            JSON.stringify({
              payment_status:
                "FAILED"
            })
        }
      );

    return {
      handled:
        true,

      type:
        "WALLET_TOPUP",

      status:
        "FAILED",

      updated:
        Array.isArray(rows)
          ? rows.length
          : 0
    };
  }

  /*
   * Pedido de bilhete.
   */
  return {
    handled:
      true,

    type:
      "TICKET",

    failed:
      await markOrderFailed(
        payment
      )
  };
}

export default async function handler(
  req,
  res
) {
  if (
    req.method !==
    "POST"
  ) {
    res.setHeader(
      "Allow",
      "POST"
    );

    return sendJson(
      res,
      405,
      {
        success:
          false,

        error:
          "METHOD_NOT_ALLOWED"
      }
    );
  }

  const webhookSecret =
    process.env.PAGAR_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error(
      "PAGAR WEBHOOK: PAGAR_WEBHOOK_SECRET não configurado"
    );

    return sendJson(
      res,
      500,
      {
        success:
          false,

        error:
          "WEBHOOK_CONFIG_ERROR"
      }
    );
  }

  const rawBody =
    await readRawBody(
      req
    );

  const signature =
    getHeader(
      req,
      "pagar-signature"
    );

  /*
   * Verifica a assinatura ANTES de interpretar
   * o conteúdo do webhook.
   */
  if (
    !verifyWebhookSignature(
      rawBody,
      signature,
      webhookSecret
    )
  ) {
    console.error(
      "PAGAR WEBHOOK: assinatura inválida"
    );

    return sendJson(
      res,
      401,
      {
        success:
          false,

        error:
          "INVALID_SIGNATURE"
      }
    );
  }

  let event;

  try {
    event =
      JSON.parse(
        rawBody.toString(
          "utf8"
        )
      );
  } catch (error) {
    console.error(
      "PAGAR WEBHOOK JSON ERROR:",
      error.message
    );

    return sendJson(
      res,
      400,
      {
        success:
          false,

        error:
          "INVALID_JSON"
      }
    );
  }

  const eventId =
    String(
      getHeader(
        req,
        "pagar-event-id"
      ) ||
      event?.id ||
      event?.eventId ||
      ""
    ).trim();

  if (!eventId) {
    return sendJson(
      res,
      400,
      {
        success:
          false,

        error:
          "EVENT_ID_REQUIRED"
      }
    );
  }

  const eventType =
    String(
      event?.type ||
      event?.event_type ||
      event?.eventType ||
      ""
    ).trim();

  const payment =
    getPaymentFromEvent(
      event
    );

  const paymentId =
    getPaymentId(
      payment
    );

  /*
   * Registra o evento antes do processamento.
   *
   * Se já existir, não processamos novamente.
   */
  let registration;

  try {
    registration =
      await registerWebhookEvent(
        eventId,
        eventType,
        paymentId,
        event
      );
  } catch (error) {
    console.error(
      "PAGAR WEBHOOK REGISTER ERROR:",
      error.message
    );

    return sendJson(
      res,
      500,
      {
        success:
          false,

        error:
          "WEBHOOK_EVENT_REGISTER_FAILED"
      }
    );
  }

  const processingToken = crypto.randomUUID();
  let claimed;

  try {
    claimed = await claimWebhookEvent(eventId, processingToken);
  } catch (error) {
    console.error("PAGAR WEBHOOK CLAIM ERROR:", error.message);
    return sendJson(res, 500, {
      success: false,
      error: "WEBHOOK_EVENT_CLAIM_FAILED"
    });
  }

  if (!claimed) {
    return sendJson(res, 200, {
      success: true,
      duplicate: true,
      in_progress: true,
      event_id: eventId,
      message: "Evento já processado ou em processamento."
    });
  }

  /*
   * Teste do webhook.
   */
  if (
    eventType ===
    "webhook.test"
  ) {
    try {
      await markWebhookProcessed(eventId, processingToken);
    } catch (error) {
      console.error(
        "PAGAR WEBHOOK FINISH ERROR (teste):",
        error.message
      );

      return sendJson(res, 500, {
        success: false,
        error: "WEBHOOK_EVENT_FINISH_FAILED"
      });
    }

    return sendJson(
      res,
      200,
      {
        success:
          true,

        test:
          true,

        event_id:
          eventId
      }
    );
  }

  /*
   * Eventos que não alteram estado financeiro
   * podem ser reconhecidos sem processamento.
   */
  if (
    eventType !==
      "payment.succeeded" &&
    eventType !==
      "payment.failed"
  ) {
    try {
      await markWebhookProcessed(eventId, processingToken);
    } catch (error) {
      console.error(
        "PAGAR WEBHOOK FINISH ERROR (ignorado):",
        error.message
      );

      return sendJson(res, 500, {
        success: false,
        error: "WEBHOOK_EVENT_FINISH_FAILED"
      });
    }

    return sendJson(
      res,
      200,
      {
        success:
          true,

        ignored:
          true,

        event_id:
          eventId,

        event_type:
          eventType
      }
    );
  }

  if (!payment) {
    console.error(
      "PAGAR WEBHOOK: payment não encontrado no evento"
    );

    await releaseWebhookClaim(eventId, processingToken);

    return sendJson(
      res,
      400,
      {
        success:
          false,

        error:
          "PAYMENT_NOT_FOUND"
      }
    );
  }

  try {
    /*
     * ----------------------------------------------------------
     * PAYMENT SUCCEEDED
     * ----------------------------------------------------------
     */
    if (
      eventType ===
      "payment.succeeded"
    ) {
      const status =
        getPaymentStatus(
          payment
        );

      /*
       * Só tratamos como pagamento concluído
       * quando o próprio Pagar informa PAID.
       */
      if (
        status !==
        "PAID"
      ) {
        await markWebhookProcessed(eventId, processingToken);

        return sendJson(
          res,
          200,
          {
            success:
              true,

            ignored:
              true,

            reason:
              "PAYMENT_NOT_PAID",

            status,

            event_id:
              eventId
          }
        );
      }

      const result =
        await processPaymentSucceeded(
          payment
        );

      await markWebhookProcessed(eventId, processingToken);

      return sendJson(
        res,
        200,
        {
          success:
            true,

          event_id:
            eventId,

          event_type:
            eventType,

          result
        }
      );
    }

    /*
     * ----------------------------------------------------------
     * PAYMENT FAILED
     * ----------------------------------------------------------
     */
    if (
      eventType ===
      "payment.failed"
    ) {
      const result =
        await processPaymentFailed(
          payment
        );

      await markWebhookProcessed(eventId, processingToken);

      return sendJson(
        res,
        200,
        {
          success:
            true,

          event_id:
            eventId,

          event_type:
            eventType,

          result
        }
      );
    }
  } catch (error) {
    console.error(
      "PAGAR WEBHOOK PROCESS ERROR:",
      error
    );

    /*
     * NÃO marcamos processed_at em caso de erro.
     *
     * Isso permite que o Pagar reenvie o webhook
     * e o evento seja novamente processado.
     */
    try {
      await releaseWebhookClaim(eventId, processingToken);
    } catch (releaseError) {
      console.error(
        "PAGAR WEBHOOK CLAIM RELEASE ERROR:",
        releaseError.message
      );
    }

    return sendJson(
      res,
      500,
      {
        success:
          false,

        error:
          "WEBHOOK_PROCESSING_FAILED",

        detail:
          error?.message ||
          "Erro ao processar webhook"
      }
    );
  }

  return sendJson(
    res,
    200,
    {
      success:
        true
    }
  );
}