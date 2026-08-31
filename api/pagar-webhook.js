import crypto from "node:crypto";

export const config = {
  api: {
    bodyParser: false,
  },
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const PAGAR_WEBHOOK_SECRET =
  process.env.PAGAR_WEBHOOK_SECRET;

function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify(data));
}

function getHeader(req, name) {
  const value = req.headers?.[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

/**
 * Lê o corpo ORIGINAL da requisição.
 *
 * Isto é fundamental porque a Pagar assina:
 *
 * timestamp + "." + rawBody
 *
 * Se o JSON for reconstruído antes da validação,
 * a assinatura pode deixar de coincidir.
 */
async function readRawBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk)
    );
  }

  return Buffer.concat(chunks);
}

/**
 * Verifica a assinatura oficial do webhook Pagar.
 */
function verifyPagarSignature(req, rawBody) {
  if (!PAGAR_WEBHOOK_SECRET) {
    throw new Error(
      "PAGAR_WEBHOOK_SECRET não configurado."
    );
  }

  const eventId = getHeader(
    req,
    "pagar-event-id"
  );

  const signatureHeader =
    getHeader(
      req,
      "pagar-signature"
    ) || "";

  if (!eventId) {
    return {
      valid: false,
      reason: "Pagar-Event-Id ausente.",
    };
  }

  const parts = {};

  for (const part of signatureHeader.split(",")) {
    const separator = part.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key = part
      .slice(0, separator)
      .trim();

    const value = part
      .slice(separator + 1)
      .trim();

    parts[key] = value;
  }

  const timestamp = parts.t;
  const receivedSignature = parts.v1;

  if (!timestamp || !receivedSignature) {
    return {
      valid: false,
      reason: "Pagar-Signature inválida.",
    };
  }

  if (!/^\d+$/.test(timestamp)) {
    return {
      valid: false,
      reason: "Timestamp inválido.",
    };
  }

  if (!/^[a-f0-9]{64}$/i.test(receivedSignature)) {
    return {
      valid: false,
      reason: "Formato de assinatura inválido.",
    };
  }

  /*
   * A Pagar usa uma janela de 5 minutos
   * para evitar replay attacks.
   */
  const timestampSeconds =
    Number(timestamp);

  const nowSeconds =
    Math.floor(Date.now() / 1000);

  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(
      nowSeconds - timestampSeconds
    ) > 300
  ) {
    return {
      valid: false,
      reason:
        "Webhook fora da janela de 5 minutos.",
    };
  }

  /*
   * Payload EXATO usado pela Pagar:
   *
   * timestamp + "." + rawBody
   */
  const signedPayload =
    timestamp +
    "." +
    rawBody.toString("utf8");

  const expectedSignature =
    crypto
      .createHmac(
        "sha256",
        PAGAR_WEBHOOK_SECRET
      )
      .update(signedPayload)
      .digest("hex");

  const receivedBuffer =
    Buffer.from(
      receivedSignature,
      "hex"
    );

  const expectedBuffer =
    Buffer.from(
      expectedSignature,
      "hex"
    );

  if (
    receivedBuffer.length !==
    expectedBuffer.length
  ) {
    return {
      valid: false,
      reason: "Assinatura inválida.",
    };
  }

  const valid =
    crypto.timingSafeEqual(
      receivedBuffer,
      expectedBuffer
    );

  return {
    valid,
    eventId,
    timestamp,
  };
}

/**
 * Consulta o Supabase diretamente pela REST API.
 */
async function supabaseRequest(
  path,
  options = {}
) {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Credenciais do Supabase não configuradas."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,

      headers: {
        apikey:
          SUPABASE_SERVICE_ROLE_KEY,

        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

        "Content-Type":
          "application/json",

        ...(options.headers || {}),
      },
    }
  );

  const text =
    await response.text();

  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const error = new Error(
      "Erro ao comunicar com o Supabase."
    );

    error.status =
      response.status;

    error.data = data;

    throw error;
  }

  return data;
}

/**
 * Registra o evento somente uma vez.
 *
 * O índice UNIQUE de event_id protege
 * contra webhooks duplicados.
 */
async function registerEvent({
  eventId,
  eventType,
  paymentId,
  reference,
  status,
  payload,
}) {
  const response =
    await fetch(
      `${SUPABASE_URL}/rest/v1/pagar_webhook_events`,
      {
        method: "POST",

        headers: {
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,

          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

          "Content-Type":
            "application/json",

          /*
           * Se event_id já existir,
           * o Supabase ignora a duplicação.
           */
          Prefer:
            "return=representation,resolution=ignore-duplicates",
        },

        body: JSON.stringify({
          event_id: eventId,

          event_type:
            eventType,

          payment_id:
            paymentId,

          payment_reference:
            reference,

          payment_status:
            status,

          payload,
        }),
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Erro ao registrar evento no Supabase: ${text}`
    );
  }

  if (!text) {
    return {
      inserted: false,
    };
  }

  const data =
    JSON.parse(text);

  return {
    inserted:
      Array.isArray(data) &&
      data.length > 0,
  };
}

export default async function handler(
  req,
  res
) {
  /*
   * ------------------------------------------------
   * 1. SOMENTE POST
   * ------------------------------------------------
   */

  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      message:
        "Método não permitido.",
    });
  }

  try {
    /*
     * ------------------------------------------------
     * 2. RAW BODY
     * ------------------------------------------------
     */

    const rawBody =
      await readRawBody(req);

    /*
     * ------------------------------------------------
     * 3. VERIFICAR ASSINATURA
     * ------------------------------------------------
     */

    const verification =
      verifyPagarSignature(
        req,
        rawBody
      );

    if (!verification.valid) {
      console.warn(
        "PAGAR WEBHOOK REJEITADO:",
        verification.reason
      );

      return json(res, 401, {
        success: false,
        message:
          "Webhook não autorizado.",
      });
    }

    const eventId =
      verification.eventId;

    /*
     * ------------------------------------------------
     * 4. PARSE DO JSON
     * ------------------------------------------------
     */

    let event;

    try {
      event = JSON.parse(
        rawBody.toString("utf8")
      );
    } catch {
      return json(res, 400, {
        success: false,
        message:
          "JSON inválido.",
      });
    }

    /*
     * ------------------------------------------------
     * 5. EXTRAIR PAGAMENTO
     * ------------------------------------------------
     */

    const eventType =
      event.type ||
      event.event ||
      null;

    const payment =
      event.payment ||
      event.data?.payment ||
      event.data ||
      {};

    const paymentId =
      payment.id ||
      null;

    const reference =
      payment.reference ||
      event.reference ||
      null;

    const status =
      String(
        payment.status ||
        event.status ||
        ""
      ).toUpperCase();

    console.log(
      "PAGAR WEBHOOK RECEBIDO:",
      JSON.stringify({
        eventId,
        eventType,
        paymentId,
        reference,
        status,
      })
    );

    /*
     * ------------------------------------------------
     * 6. REGISTRAR EVENTO
     * ------------------------------------------------
     */

    const registration =
      await registerEvent({
        eventId,
        eventType,
        paymentId,
        reference,
        status,
        payload: event,
      });

    /*
     * ------------------------------------------------
     * 7. WEBHOOK DUPLICADO
     * ------------------------------------------------
     */

    if (!registration.inserted) {
      console.log(
        "WEBHOOK DUPLICADO IGNORADO:",
        eventId
      );

      return json(res, 200, {
        success: true,
        received: true,
        duplicate: true,
        eventId,
      });
    }

    /*
     * ------------------------------------------------
     * 8. PAGAMENTO CONFIRMADO
     * ------------------------------------------------
     */

    if (
      eventType ===
        "payment.succeeded" ||
      status === "PAID"
    ) {
      console.log(
        "PAGAMENTO CONFIRMADO:",
        {
          eventId,
          paymentId,
          reference,
        }
      );

      /*
       * AQUI entraremos na próxima etapa:
       *
       * Supabase:
       *
       * blackout_orders
       *       ↓
       * reference
       *       ↓
       * status = PAID
       *       ↓
       * payment_id
       *       ↓
       * gerar bilhete
       *
       * Ainda NÃO geramos o bilhete aqui porque
       * precisamos primeiro conhecer exatamente
       * a estrutura da tabela blackout_orders.
       */

      return json(res, 200, {
        success: true,
        received: true,
        eventId,
        paymentId,
        reference,
        status: "PAID",
      });
    }

    /*
     * ------------------------------------------------
     * 9. PAGAMENTO FALHOU
     * ------------------------------------------------
     */

    if (
      eventType ===
        "payment.failed" ||
      status === "FAILED"
    ) {
      console.log(
        "PAGAMENTO FALHOU:",
        {
          eventId,
          paymentId,
          reference,
        }
      );

      return json(res, 200, {
        success: true,
        received: true,
        eventId,
        paymentId,
        reference,
        status: "FAILED",
      });
    }

    /*
     * ------------------------------------------------
     * 10. OUTROS EVENTOS
     * ------------------------------------------------
     */

    return json(res, 200, {
      success: true,
      received: true,
      eventId,
      event: eventType,
      status: status || null,
    });

  } catch (error) {
    console.error(
      "PAGAR WEBHOOK ERROR:",
      error
    );

    /*
     * 500 faz a Pagar saber que o processamento
     * não terminou corretamente.
     */

    return json(res, 500, {
      success: false,
      message:
        "Erro interno ao processar webhook.",
    });
  }
}
