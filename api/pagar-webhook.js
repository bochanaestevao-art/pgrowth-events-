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

const SITE_URL =
  process.env.SITE_URL ||
  "https://pgrowth-events.vercel.app";

function json(res, status, data) {
  return res.status(status).json(data);
}

/**
 * Lê exatamente o body recebido pela Pagar.
 * A assinatura depende do raw body.
 */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => {
      chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk)
      );
    });

    req.on("end", () => {
      resolve(
        Buffer.concat(chunks).toString("utf8")
      );
    });

    req.on("error", reject);
  });
}

/**
 * Validação oficial:
 *
 * Pagar-Signature:
 * t=TIMESTAMP,v1=SIGNATURE
 *
 * assinatura =
 * HMAC-SHA256(
 *   timestamp + "." + rawBody,
 *   PAGAR_WEBHOOK_SECRET
 * )
 */
function verifySignature(rawBody, header) {
  if (!PAGAR_WEBHOOK_SECRET) {
    return {
      valid: false,
      reason: "PAGAR_WEBHOOK_SECRET não configurado",
    };
  }

  if (!header) {
    return {
      valid: false,
      reason: "Pagar-Signature não recebido",
    };
  }

  const parts = {};

  for (const part of String(header).split(",")) {
    const index = part.indexOf("=");

    if (index === -1) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (!parts[key]) {
      parts[key] = [];
    }

    parts[key].push(value);
  }

  const timestamp = parts.t?.[0];
  const receivedSignatures = parts.v1 || [];

  if (!timestamp || !/^\d+$/.test(timestamp)) {
    return {
      valid: false,
      reason: "Timestamp inválido",
    };
  }

  if (receivedSignatures.length === 0) {
    return {
      valid: false,
      reason: "v1 da assinatura ausente",
    };
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (
    Math.abs(nowSeconds - timestampSeconds) > 300
  ) {
    return {
      valid: false,
      reason: "Timestamp expirado",
    };
  }

  const signedPayload = `${timestamp}.${rawBody}`;

  const expectedSignature = crypto
    .createHmac(
      "sha256",
      PAGAR_WEBHOOK_SECRET
    )
    .update(signedPayload)
    .digest("hex");

  const expectedBuffer = Buffer.from(
    expectedSignature,
    "hex"
  );

  for (const receivedSignature of receivedSignatures) {
    if (!/^[a-f0-9]{64}$/i.test(receivedSignature)) {
      continue;
    }

    const receivedBuffer = Buffer.from(
      receivedSignature,
      "hex"
    );

    if (
      receivedBuffer.length ===
        expectedBuffer.length &&
      crypto.timingSafeEqual(
        receivedBuffer,
        expectedBuffer
      )
    ) {
      return {
        valid: true,
        reason: null,
      };
    }
  }

  return {
    valid: false,
    reason: "Assinatura HMAC não corresponde",
  };
}

/**
 * Supabase REST
 */
async function supabase(path, options = {}) {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Variáveis do Supabase não configuradas"
    );
  }
console.log(
  "SUPABASE REQUEST:",
  `${SUPABASE_URL}/rest/v1/${path}`
);
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
    throw new Error(
      data?.message ||
        data?.hint ||
        "Erro no Supabase"
    );
  }

  return data;
}

/**
 * Registra Pagar-Event-Id.
 *
 * A coluna event_id precisa ser UNIQUE.
 */
async function registerEvent(
  eventId,
  eventType,
  paymentId,
  payload
) {
  try {
  const result =
    await supabase(
      "pagar_webhook_events",
      {
        method: "POST",

        headers: {
          Prefer:
            "return=representation,resolution=ignore-duplicates",
        },

        body: JSON.stringify({
          event_id: eventId,
          event_type:
            eventType || null,
          pagar_payment_id:
            paymentId || null,
          payload,
        }),
      }
    );

  return (
    Array.isArray(result) &&
    result.length > 0
  );

} catch (error) {

  if (
    String(error.message || "")
      .includes("duplicate key")
  ) {
    console.log(
      "Webhook já registrado:",
      eventId
    );

    return false;
  }

  throw error;
  }
}

/**
 * Marca evento como processado.
 */
async function markProcessed(eventId) {
  await supabase(
    `pagar_webhook_events?event_id=eq.${encodeURIComponent(
      eventId
    )}`,
    {
      method: "PATCH",

      headers: {
        Prefer: "return=minimal",
      },

      body: JSON.stringify({
        processed_at:
          new Date().toISOString(),
      }),
    }
  );
}

/**
 * Atualiza o pedido.
 *
 * ATENÇÃO:
 * O nome da coluna usado aqui é
 * order_reference, conforme a estrutura
 * que você mostrou.
 */
async function markOrderPaid(payment) {
  const reference =
    payment?.reference;

  const paymentId =
    payment?.paymentId;

  if (!reference) {
    throw new Error(
      "Pagamento sem reference"
    );
  }

  if (!paymentId) {
    throw new Error(
      "Pagamento sem id"
    );
  }

  const result =
    await supabase(
      `blackout_orders?order_reference=eq.${encodeURIComponent(
        reference
      )}`,
      {
        method: "PATCH",

        headers: {
          Prefer:
            "return=representation",
        },

        body: JSON.stringify({
          payment_status: "PAID",
          pagar_payment_id: paymentId,
          payment_reference:
            reference,
        }),
      }
    );

  if (
    !Array.isArray(result) ||
    result.length === 0
  ) {
    throw new Error(
      `Pedido não encontrado: ${reference}`
    );
  }

  return result[0];
}

/**
 * Emite o bilhete depois de PAID.
 */
async function generateTicket(order) {
  const secret =
    process.env.TICKET_GENERATION_SECRET;

  if (!secret) {
    throw new Error(
      "TICKET_GENERATION_SECRET não configurado"
    );
  }

  const response =
    await fetch(
      `${SITE_URL}/api/generate-ticket`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${secret}`,
        },

        body: JSON.stringify({
          orderReference:
            order.order_reference,
        }),
      }
    );

  const text =
    await response.text();

  let data = null;

  try {
    data = text
      ? JSON.parse(text)
      : null;
  } catch {
    data = {
      raw: text,
    };
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        "Erro ao gerar bilhete"
    );
  }

  return data;
}

/**
 * Extrai o objeto payment do evento.
 */
function getPayment(event) {
  if (event?.data?.payment) {
    return event.data.payment;
  }

  if (event?.payment) {
    return event.payment;
  }

  if (event?.data?.object) {
    return event.data.object;
  }

  if (event?.data) {
    return event.data;
  }

  return null;
}

export default async function handler(
  req,
  res
) {
  /*
   * Apenas POST
   */
  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      message:
        "Método não permitido",
    });
  }

  try {
    /*
     * =====================================================
     * 1. RAW BODY
     * =====================================================
     */

    const rawBody =
      await readRawBody(req);

    if (!rawBody) {
      return json(res, 400, {
        success: false,
        message:
          "Body vazio",
      });
    }

    /*
     * =====================================================
     * 2. HEADERS PAGAR
     * =====================================================
     */

    const eventId =
      req.headers[
        "pagar-event-id"
      ];

    const signature =
      req.headers[
        "pagar-signature"
      ];

    /*
     * Node/Vercel normalmente normaliza
     * os headers para lowercase.
     */

    if (!eventId) {
      return json(res, 400, {
        success: false,
        message:
          "Pagar-Event-Id ausente",
      });
    }

    if (!signature) {
      return json(res, 401, {
        success: false,
        message:
          "Pagar-Signature ausente",
      });
    }

    /*
     * =====================================================
     * 3. VALIDAR ASSINATURA
     * =====================================================
     */

    const verification =
      verifySignature(
        rawBody,
        Array.isArray(signature)
          ? signature[0]
          : signature
      );

    if (!verification.valid) {
      console.error(
        "PAGAR WEBHOOK 401:",
        verification.reason
      );

      /*
       * NÃO mostramos secret nem assinatura
       * nos logs.
       */

      return json(res, 401, {
        success: false,
        message:
          "Assinatura do webhook inválida",
      });
    }

    /*
     * =====================================================
     * 4. JSON
     * =====================================================
     */

    let event;

    try {
      event =
        JSON.parse(rawBody);
    } catch {
      return json(res, 400, {
        success: false,
        message:
          "JSON inválido",
      });
    }

    const eventType =
      event?.type ||
      event?.event ||
      event?.name ||
      null;

    /*
     * =====================================================
     * 5. TESTE DA PAGAR
     * =====================================================
     */

    if (
      eventType ===
      "webhook.test"
    ) {
      console.log(
        "PAGAR WEBHOOK TEST OK"
      );

      return json(res, 200, {
        success: true,
        message:
          "Webhook test recebido com assinatura válida",
      });
    }

    /*
     * =====================================================
     * 6. EVENTOS DE PAGAMENTO
     * =====================================================
     */

    if (
      eventType !==
        "payment.succeeded" &&
      eventType !==
        "payment.failed"
    ) {
      console.log(
        "Evento ignorado:",
        eventType
      );

      return json(res, 200, {
        success: true,
        ignored: true,
        eventType,
      });
    }

    const payment =
      getPayment(event);
    console.log(
  "PAGAR PAYMENT:",
  JSON.stringify(payment)
);

    if (!payment) {
      return json(res, 400, {
        success: false,
        message:
          "Objeto payment ausente",
      });
    }

    /*
     * =====================================================
     * 7. IDEMPOTÊNCIA DO WEBHOOK
     * =====================================================
     */

    const isNew =
      await registerEvent(
        eventId,
        eventType,
        payment.paymentId || null,
        event
      );

    if (!isNew) {
      console.log(
        "Webhook duplicado:",
        eventId
      );

      return json(res, 200, {
        success: true,
        duplicate: true,
        eventId,
      });
    }

    /*
     * =====================================================
     * 8. PAGAMENTO FALHOU
     * =====================================================
     */

    if (
      eventType ===
      "payment.failed"
    ) {
      if (payment.reference) {
        await supabase(
          `blackout_orders?order_reference=eq.${encodeURIComponent(
            payment.reference
          )}`,
          {
            method: "PATCH",

            headers: {
              Prefer:
                "return=minimal",
            },

            body: JSON.stringify({
              payment_status:
                "FAILED",

              pagar_payment_id:
                payment.paymentId || null,

              payment_reference:
                payment.reference,
            }),
          }
        );
      }

      await markProcessed(
        eventId
      );

      return json(res, 200, {
        success: true,
        status: "FAILED",
      });
    }

    /*
     * =====================================================
     * 9. SÓ ENTREGAR COM PAID
     * =====================================================
     */

    if (
      payment.status !== "PAID"
    ) {
      console.error(
        "Pagamento não está PAID:",
        payment.status
      );

      return json(res, 200, {
        success: true,
        received: true,
        status:
          payment.status,
      });
    }

    /*
     * =====================================================
     * 10. MARCAR PEDIDO PAID
     * =====================================================
     */

    const order =
      await markOrderPaid(
        payment
      );

    /*
     * =====================================================
     * 11. GERAR BILHETE
     * =====================================================
     */

    let ticket;

    try {
      ticket =
        await generateTicket(
          order
        );
    } catch (error) {
      console.error(
        "Erro ao gerar bilhete:",
        error.message
      );

      /*
       * Pagamento já está PAID.
       * Não alteramos para FAILED.
       */

      return json(res, 500, {
        success: false,
        message:
          "Pagamento confirmado, mas o bilhete não pôde ser gerado.",
      });
    }

    /*
     * =====================================================
     * 12. FINALIZAR EVENTO
     * =====================================================
     */

    await markProcessed(
      eventId
    );

    return json(res, 200, {
      success: true,
      eventId,
      eventType,
      paymentId:
        payment.paymentId,
      paymentStatus:
        payment.status,
      orderReference:
        order.order_reference,
      ticket,
    });
  } catch (error) {
    console.error(
      "PAGAR WEBHOOK ERROR:",
      error
    );

    return json(res, 500, {
      success: false,
      message:
        "Erro interno no webhook",
    });
  }
}
// Pagar webhook TEST - redeploy