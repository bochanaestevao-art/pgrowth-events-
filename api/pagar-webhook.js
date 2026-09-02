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

function verifySignature(rawBody, header) {
  if (!PAGAR_WEBHOOK_SECRET) {
    return {
      valid: false,
      reason:
        "PAGAR_WEBHOOK_SECRET não configurado",
    };
  }

  if (!header) {
    return {
      valid: false,
      reason:
        "Pagar-Signature não recebido",
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

  if (
    !timestamp ||
    !/^\d+$/.test(timestamp)
  ) {
    return {
      valid: false,
      reason: "Timestamp inválido",
    };
  }

  if (!receivedSignatures.length) {
    return {
      valid: false,
      reason: "v1 da assinatura ausente",
    };
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(
    Date.now() / 1000
  );

  if (
    Math.abs(
      nowSeconds - timestampSeconds
    ) > 300
  ) {
    return {
      valid: false,
      reason: "Timestamp expirado",
    };
  }

  const signedPayload =
    `${timestamp}.${rawBody}`;

  const expectedSignature =
    crypto
      .createHmac(
        "sha256",
        PAGAR_WEBHOOK_SECRET
      )
      .update(signedPayload)
      .digest("hex");

  const expectedBuffer =
    Buffer.from(
      expectedSignature,
      "hex"
    );

  for (
    const receivedSignature
    of receivedSignatures
  ) {
    if (
      !/^[a-f0-9]{64}$/i.test(
        receivedSignature
      )
    ) {
      continue;
    }

    const receivedBuffer =
      Buffer.from(
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
    reason:
      "Assinatura HMAC não corresponde",
  };
}

async function supabase(
  path,
  options = {}
) {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Variáveis do Supabase não configuradas"
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
      data?.message ||
        data?.hint ||
        "Erro no Supabase"
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

async function registerOrGetEvent(
  eventId,
  eventType,
  paymentId,
  payload
) {
  const inserted =
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
          payment_id:
            paymentId || null,
          payload,
        }),
      }
    );

  if (
    Array.isArray(inserted) &&
    inserted.length > 0
  ) {
    return inserted[0];
  }

  const existing =
    await supabase(
      `pagar_webhook_events?event_id=eq.${encodeURIComponent(
        eventId
      )}&limit=1`,
      {
        method: "GET",
      }
    );

  return Array.isArray(existing) &&
    existing.length
    ? existing[0]
    : null;
}

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

async function markOrderPaid(payment) {
  const reference =
    payment?.reference;

  const paymentId =
    payment?.id ||
    payment?.paymentId ||
    null;

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
          pagar_payment_id:
            paymentId,
          payment_reference:
            reference,
          paid_at:
            new Date().toISOString(),
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

async function markOrderFailed(payment) {
  const reference =
    payment?.reference;

  if (!reference) {
    return;
  }

  const paymentId =
    payment?.id ||
    payment?.paymentId ||
    null;

  await supabase(
    `blackout_orders?order_reference=eq.${encodeURIComponent(
      reference
    )}&payment_status=neq.PAID`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        payment_status: "FAILED",
        pagar_payment_id:
          paymentId,
        payment_reference:
          reference,
      }),
    }
  );
}

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

          /*
           * IMPORTANTE:
           * generate-ticket verifica este header.
           */
          "x-ticket-generation-secret":
            secret,
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
  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      message: "Método não permitido",
    });
  }

  try {
    const rawBody =
      await readRawBody(req);

    if (!rawBody) {
      return json(res, 400, {
        success: false,
        message: "Body vazio",
      });
    }

    const eventId =
      Array.isArray(
        req.headers["pagar-event-id"]
      )
        ? req.headers[
            "pagar-event-id"
          ][0]
        : req.headers[
            "pagar-event-id"
          ];

    const signature =
      Array.isArray(
        req.headers["pagar-signature"]
      )
        ? req.headers[
            "pagar-signature"
          ][0]
        : req.headers[
            "pagar-signature"
          ];

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

    const verification =
      verifySignature(
        rawBody,
        signature
      );

    if (!verification.valid) {
      console.error(
        "PAGAR WEBHOOK 401:",
        verification.reason
      );

      return json(res, 401, {
        success: false,
        message:
          "Assinatura do webhook inválida",
      });
    }

    let event;

    try {
      event =
        JSON.parse(rawBody);
    } catch {
      return json(res, 400, {
        success: false,
        message: "JSON inválido",
      });
    }

    const eventType =
      event?.type ||
      event?.event ||
      event?.name ||
      null;

    if (
      eventType ===
      "webhook.test"
    ) {
      return json(res, 200, {
        success: true,
        message:
          "Webhook test recebido com assinatura válida",
      });
    }

    if (
      eventType !==
        "payment.succeeded" &&
      eventType !==
        "payment.failed"
    ) {
      return json(res, 200, {
        success: true,
        ignored: true,
        eventType,
      });
    }

    const payment =
      getPayment(event);

    if (!payment) {
      return json(res, 400, {
        success: false,
        message:
          "Objeto payment ausente",
      });
    }

    const paymentId =
      payment?.id ||
      payment?.paymentId ||
      null;

    console.log(
      "PAGAR PAYMENT:",
      JSON.stringify({
        id: paymentId,
        reference:
          payment?.reference || null,
        status:
          payment?.status || null,
      })
    );

    const storedEvent =
      await registerOrGetEvent(
        eventId,
        eventType,
        paymentId,
        event
      );

    if (!storedEvent) {
      throw new Error(
        "Não foi possível registrar ou recuperar o webhook."
      );
    }

    /*
     * Se já foi processado, acabou.
     *
     * Se existe mas processed_at está vazio,
     * NÃO tratamos como duplicado definitivo.
     * Tentamos processar novamente.
     */
    if (storedEvent.processed_at) {
      return json(res, 200, {
        success: true,
        duplicate: true,
        processed: true,
        eventId,
      });
    }

    if (
      eventType ===
      "payment.failed"
    ) {
      await markOrderFailed(
        payment
      );

      await markProcessed(
        eventId
      );

      return json(res, 200, {
        success: true,
        status: "FAILED",
        eventId,
      });
    }

    /*
     * payment.succeeded só entrega quando
     * o estado final é PAID.
     */
    const paymentStatus =
      String(
        payment?.status || ""
      ).toUpperCase();

    if (paymentStatus !== "PAID") {
      /*
       * Não marcamos processed_at.
       * Se a Pagar reenviar posteriormente
       * com PAID, este evento ainda poderá
       * ser processado.
       */
      return json(res, 200, {
        success: true,
        received: true,
        eventId,
        status: paymentStatus,
      });
    }

    const order =
      await markOrderPaid(
        payment
      );

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
       * NÃO marcamos o evento como processado.
       * Um retry da Pagar poderá recuperar.
       */
      return json(res, 500, {
        success: false,
        message:
          "Pagamento confirmado, mas o bilhete não pôde ser gerado.",
      });
    }

    await markProcessed(
      eventId
    );

    return json(res, 200, {
      success: true,
      eventId,
      eventType,
      paymentId,
      paymentStatus,
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
