import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const PAGAR_WEBHOOK_SECRET =
  process.env.PAGAR_WEBHOOK_SECRET;

const SITE_URL =
  process.env.SITE_URL ||
  "https://pgrowth-events.vercel.app";

function sendJson(res, status, data) {
  res.status(status).json(data);
}

/*
 * ---------------------------------------------------------
 * LER O RAW BODY
 * ---------------------------------------------------------
 *
 * A assinatura da Pagar precisa do body EXATO recebido.
 * Não podemos fazer JSON.stringify(req.body), porque isso
 * poderia alterar espaços, ordem ou representação do JSON.
 */

async function getRawBody(req) {
  if (Buffer.isBuffer(req.body)) {
    return req.body.toString("utf8");
  }

  if (typeof req.body === "string") {
    return req.body;
  }

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

/*
 * ---------------------------------------------------------
 * VALIDAR ASSINATURA PAGAR
 * ---------------------------------------------------------
 *
 * Formato oficial:
 *
 * Pagar-Signature:
 * t=TIMESTAMP,v1=SIGNATURE
 *
 * Assinatura:
 *
 * HMAC-SHA256(
 *   timestamp + "." + rawBody,
 *   PAGAR_WEBHOOK_SECRET
 * )
 */

function verifyPagarSignature(
  rawBody,
  signatureHeader
) {
  if (!PAGAR_WEBHOOK_SECRET) {
    throw new Error(
      "PAGAR_WEBHOOK_SECRET não configurado no Vercel."
    );
  }

  if (!signatureHeader) {
    return {
      valid: false,
      reason: "Header Pagar-Signature ausente.",
    };
  }

  const parts = {};

  for (
    const item of signatureHeader.split(",")
  ) {
    const separator = item.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key = item
      .slice(0, separator)
      .trim();

    const value = item
      .slice(separator + 1)
      .trim();

    parts[key] = value;
  }

  const timestamp = parts.t;
  const receivedSignature = parts.v1;

  if (
    !timestamp ||
    !/^\d+$/.test(timestamp)
  ) {
    return {
      valid: false,
      reason: "Timestamp da assinatura inválido.",
    };
  }

  if (
    !receivedSignature ||
    !/^[a-f0-9]{64}$/i.test(
      receivedSignature
    )
  ) {
    return {
      valid: false,
      reason: "Assinatura inválida.",
    };
  }

  /*
   * Proteção contra replay.
   *
   * A documentação da Pagar recomenda rejeitar
   * timestamps com mais de 300 segundos.
   */

  const timestampSeconds =
    Number(timestamp);

  const currentSeconds =
    Math.floor(Date.now() / 1000);

  const difference = Math.abs(
    currentSeconds - timestampSeconds
  );

  if (difference > 300) {
    return {
      valid: false,
      reason: "Timestamp expirado.",
    };
  }

  const signedPayload =
    timestamp + "." + rawBody;

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
      reason: "Assinatura não corresponde.",
    };
  }

  const valid =
    crypto.timingSafeEqual(
      receivedBuffer,
      expectedBuffer
    );

  return {
    valid,
    reason: valid
      ? null
      : "Assinatura não corresponde.",
  };
}

/*
 * ---------------------------------------------------------
 * SUPABASE REQUEST
 * ---------------------------------------------------------
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
      "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurado."
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
    const message =
      typeof data === "object" &&
      data?.message
        ? data.message
        : typeof data === "object" &&
          data?.hint
        ? data.hint
        : "Erro no Supabase.";

    const error =
      new Error(message);

    error.status =
      response.status;

    error.data = data;

    throw error;
  }

  return data;
}

/*
 * ---------------------------------------------------------
 * EXTRAIR PAYMENT DO EVENTO
 * ---------------------------------------------------------
 *
 * Mantemos alguma tolerância ao formato do envelope para
 * evitar quebrar caso o objeto payment venha em data,
 * payment ou data.object.
 */

function extractPayment(event) {
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
    event?.data
  ) {
    return event.data;
  }

  return null;
}

/*
 * ---------------------------------------------------------
 * MARCAR EVENTO COMO RECEBIDO
 * ---------------------------------------------------------
 *
 * O event_id tem UNIQUE no Supabase.
 *
 * Se já existir, o webhook é duplicado.
 */

async function registerEvent(
  eventId,
  eventType,
  paymentId
) {
  const result =
    await supabaseRequest(
      "pagar_webhook_events?on_conflict=event_id",
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
        }),
      }
    );

  /*
   * Se o Supabase ignorou por conflito,
   * não haverá uma nova linha.
   */

  if (
    !Array.isArray(result) ||
    result.length === 0
  ) {
    return false;
  }

  return true;
}

/*
 * ---------------------------------------------------------
 * MARCAR EVENTO PROCESSADO
 * ---------------------------------------------------------
 */

async function markEventProcessed(
  eventId
) {
  await supabaseRequest(
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

/*
 * ---------------------------------------------------------
 * ATUALIZAR PEDIDO PARA PAID
 * ---------------------------------------------------------
 */

async function updateOrderPaid(
  payment
) {
  const reference =
    payment?.reference;

  const paymentId =
    payment?.id;

  if (!reference) {
    throw new Error(
      "Pagamento recebido sem reference."
    );
  }

  if (!paymentId) {
    throw new Error(
      "Pagamento recebido sem payment.id."
    );
  }

  /*
   * Atualizamos usando a reference criada pelo
   * nosso sistema.
   *
   * O preço não vem do webhook para determinar
   * o valor do pedido.
   */

  const updated =
    await supabaseRequest(
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
          payment_id: paymentId,
          payment_reference:
            reference,
        }),
      }
    );

  if (
    !Array.isArray(updated) ||
    updated.length === 0
  ) {
    throw new Error(
      `Pedido não encontrado para reference: ${reference}`
    );
  }

  return updated[0];
}

/*
 * ---------------------------------------------------------
 * GERAR BILHETE
 * ---------------------------------------------------------
 *
 * O generate-ticket.js deve ser uma função interna do
 * nosso próprio domínio.
 *
 * TICKET_GENERATION_SECRET protege a chamada para que
 * qualquer pessoa na internet não consiga emitir bilhetes.
 */

async function generateTicket(
  order
) {
  const ticketSecret =
    process.env.TICKET_GENERATION_SECRET;

  if (!ticketSecret) {
    throw new Error(
      "TICKET_GENERATION_SECRET não configurado."
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
            `Bearer ${ticketSecret}`,
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
        "Falha ao gerar o bilhete."
    );
  }

  return data;
}

/*
 * ---------------------------------------------------------
 * HANDLER VERCEL
 * ---------------------------------------------------------
 */

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return sendJson(res, 405, {
      success: false,
      message:
        "Método não permitido.",
    });
  }

  try {
    /*
     * IMPORTANTE:
     *
     * Pegamos o body bruto ANTES de JSON.parse().
     */

    const rawBody =
      await getRawBody(req);

    if (!rawBody) {
      return sendJson(res, 400, {
        success: false,
        message:
          "Body vazio.",
      });
    }

    /*
     * -----------------------------------------------------
     * HEADERS PAGAR
     * -----------------------------------------------------
     */

    const eventId =
      req.headers["pagar-event-id"];

    const signatureHeader =
      req.headers["pagar-signature"];

    if (!eventId) {
      return sendJson(res, 400, {
        success: false,
        message:
          "Pagar-Event-Id ausente.",
      });
    }

    if (!signatureHeader) {
      return sendJson(res, 401, {
        success: false,
        message:
          "Pagar-Signature ausente.",
      });
    }

    /*
     * -----------------------------------------------------
     * VALIDAR ASSINATURA
     * -----------------------------------------------------
     */

    const verification =
      verifyPagarSignature(
        rawBody,
        signatureHeader
      );

    if (!verification.valid) {
      console.error(
        "PAGAR WEBHOOK ASSINATURA INVALIDA:",
        verification.reason
      );

      return sendJson(res, 401, {
        success: false,
        message:
          "Assinatura do webhook inválida.",
      });
    }

    /*
     * -----------------------------------------------------
     * PARSE DO EVENTO
     * -----------------------------------------------------
     */

    let event;

    try {
      event =
        JSON.parse(rawBody);
    } catch {
      return sendJson(res, 400, {
        success: false,
        message:
          "JSON inválido.",
      });
    }

    const eventType =
      event?.type ||
      event?.event ||
      event?.name ||
      null;

    /*
     * -----------------------------------------------------
     * WEBHOOK TEST
     * -----------------------------------------------------
     *
     * O botão "Testar" da Pagar envia webhook.test.
     *
     * Não devemos gerar bilhete nesse evento.
     */

    if (
      eventType === "webhook.test"
    ) {
      return sendJson(res, 200, {
        success: true,
        message:
          "Webhook de teste recebido.",
      });
    }

    /*
     * -----------------------------------------------------
     * PAYMENT
     * -----------------------------------------------------
     */

    const payment =
      extractPayment(event);

    const paymentId =
      payment?.id || null;

    /*
     * Só processamos eventos de pagamento.
     */

    const isPaymentSucceeded =
      eventType ===
      "payment.succeeded";

    const isPaymentFailed =
      eventType ===
      "payment.failed";

    if (
      !isPaymentSucceeded &&
      !isPaymentFailed
    ) {
      /*
       * Outros eventos podem existir na app.
       *
       * A assinatura já foi validada, portanto
       * respondemos 200 para a Pagar.
       */

      console.log(
        "PAGAR WEBHOOK EVENTO IGNORADO:",
        eventType
      );

      return sendJson(res, 200, {
        success: true,
        received: true,
        ignored: true,
        eventType,
      });
    }

    if (!payment) {
      return sendJson(res, 400, {
        success: false,
        message:
          "Evento de pagamento sem objeto payment.",
      });
    }

    /*
     * -----------------------------------------------------
     * PROTEÇÃO CONTRA DUPLICAÇÃO
     * -----------------------------------------------------
     */

    const isNewEvent =
      await registerEvent(
        eventId,
        eventType,
        paymentId
      );

    if (!isNewEvent) {
      console.log(
        "PAGAR WEBHOOK DUPLICADO:",
        eventId
      );

      return sendJson(res, 200, {
        success: true,
        duplicate: true,
        eventId,
      });
    }

    /*
     * -----------------------------------------------------
     * PAYMENT FAILED
     * -----------------------------------------------------
     */

    if (isPaymentFailed) {
      const reference =
        payment?.reference;

      if (reference) {
        try {
          await supabaseRequest(
            `blackout_orders?order_reference=eq.${encodeURIComponent(
              reference
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

                payment_id:
                  paymentId,

                payment_reference:
                  reference,
              }),
            }
          );
        } catch (error) {
          console.error(
            "Erro ao atualizar FAILED:",
            error
          );

          throw error;
        }
      }

      await markEventProcessed(
        eventId
      );

      return sendJson(res, 200, {
        success: true,
        status: "FAILED",
      });
    }

    /*
     * -----------------------------------------------------
     * PAYMENT SUCCEEDED
     * -----------------------------------------------------
     *
     * A Pagar recomenda entregar somente quando o estado
     * financeiro é PAID.
     */

    if (
      payment.status !== "PAID"
    ) {
      console.error(
        "payment.succeeded recebido com status inesperado:",
        payment.status
      );

      return sendJson(res, 400, {
        success: false,
        message:
          "Pagamento não está em estado PAID.",
      });
    }

    /*
     * -----------------------------------------------------
     * ATUALIZAR PEDIDO
     * -----------------------------------------------------
     */

    const order =
      await updateOrderPaid(
        payment
      );

    /*
     * -----------------------------------------------------
     * GERAR BILHETE
     * -----------------------------------------------------
     */

    let ticketResult = null;

    try {
      ticketResult =
        await generateTicket(
          order
        );
    } catch (ticketError) {
      /*
       * O pagamento está confirmado.
       *
       * Não alteramos PAID para FAILED.
       * O problema agora é somente na emissão.
       */

      console.error(
        "ERRO AO GERAR BILHETE:",
        ticketError
      );

      /*
       * Deixamos o evento sem processed_at.
       *
       * ATENÇÃO:
       * como event_id já está registrado, uma nova entrega
       * do mesmo webhook será considerada duplicada.
       *
       * Por isso, a produção ideal é ter uma fila/outbox.
       *
       * Para este projeto, registramos o erro e retornamos
       * 500 para a Pagar tentar novamente.
       */

      return sendJson(res, 500, {
        success: false,
        message:
          "Pagamento confirmado, mas houve erro ao emitir o bilhete.",
      });
    }

    /*
     * -----------------------------------------------------
     * FINALIZAR EVENTO
     * -----------------------------------------------------
     */

    await markEventProcessed(
      eventId
    );

    /*
     * -----------------------------------------------------
     * SUCESSO
     * -----------------------------------------------------
     */

    return sendJson(res, 200, {
      success: true,

      eventId,

      eventType,

      paymentId,

      paymentStatus:
        payment.status,

      orderReference:
        order.order_reference,

      ticket:
        ticketResult,
    });
  } catch (error) {
    console.error(
      "PAGAR WEBHOOK ERROR:",
      error
    );

    return sendJson(res, 500, {
      success: false,
      message:
        "Erro interno ao processar webhook.",
    });
  }
          }
