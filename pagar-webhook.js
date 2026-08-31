import crypto from "node:crypto";

export const config = {
  api: {
    bodyParser: false,
  },
};

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const PAGAR_WEBHOOK_SECRET =
  process.env.PAGAR_WEBHOOK_SECRET;

const SITE_URL =
  process.env.SITE_URL;

const TICKET_GENERATION_SECRET =
  process.env.TICKET_GENERATION_SECRET;

/*
 * =========================================================
 * RESPOSTA JSON
 * =========================================================
 */

function sendJson(res, status, data) {
  res.status(status);

  res.setHeader(
    "Content-Type",
    "application/json"
  );

  return res.end(
    JSON.stringify(data)
  );
}

/*
 * =========================================================
 * LER RAW BODY
 * =========================================================
 *
 * A assinatura da Pagar é calculada sobre o body ORIGINAL.
 * Não devemos fazer JSON.stringify(req.body).
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

/*
 * =========================================================
 * SUPABASE REST
 * =========================================================
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
      "Erro na comunicação com o Supabase."
    );

    error.status =
      response.status;

    error.data =
      data;

    throw error;
  }

  return data;
}

/*
 * =========================================================
 * PARSE DA ASSINATURA PAGAR
 * =========================================================
 *
 * Formato esperado:
 *
 * Pagar-Signature:
 * t=TIMESTAMP,v1=HASH
 */

function parseSignatureHeader(
  header
) {
  const result = {};

  const parts =
    String(header || "")
      .split(",");

  for (const part of parts) {
    const separator =
      part.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key =
      part
        .slice(0, separator)
        .trim();

    const value =
      part
        .slice(separator + 1)
        .trim();

    if (key && value) {
      result[key] = value;
    }
  }

  return result;
}

/*
 * =========================================================
 * VERIFICAR ASSINATURA PAGAR
 * =========================================================
 */

function verifyPagarSignature(
  rawBody,
  signatureHeader
) {
  if (!PAGAR_WEBHOOK_SECRET) {
    throw new Error(
      "PAGAR_WEBHOOK_SECRET não configurado."
    );
  }

  const parsed =
    parseSignatureHeader(
      signatureHeader
    );

  const timestamp =
    parsed.t;

  const receivedSignature =
    parsed.v1;

  /*
   * Timestamp obrigatório
   */

  if (
    !timestamp ||
    !/^\d+$/.test(timestamp)
  ) {
    return {
      valid: false,
      reason:
        "Timestamp da assinatura inválido.",
    };
  }

  /*
   * Assinatura deve ser SHA-256 hexadecimal
   */

  if (
    !receivedSignature ||
    !/^[a-f0-9]{64}$/i.test(
      receivedSignature
    )
  ) {
    return {
      valid: false,
      reason:
        "Assinatura inválida.",
    };
  }

  /*
   * Proteção contra replay.
   *
   * A documentação da Pagar usa uma janela de 5 minutos.
   */

  const now =
    Math.floor(
      Date.now() / 1000
    );

  const webhookTime =
    Number(timestamp);

  if (
    !Number.isFinite(
      webhookTime
    )
  ) {
    return {
      valid: false,
      reason:
        "Timestamp inválido.",
    };
  }

  if (
    Math.abs(
      now - webhookTime
    ) > 300
  ) {
    return {
      valid: false,
      reason:
        "Webhook fora da janela de 5 minutos.",
    };
  }

  /*
   * A Pagar assina:
   *
   * timestamp + "." + rawBody
   */

  const signedPayload =
    `${timestamp}.${rawBody.toString(
      "utf8"
    )}`;

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
      reason:
        "Assinatura inválida.",
    };
  }

  const valid =
    crypto.timingSafeEqual(
      receivedBuffer,
      expectedBuffer
    );

  return {
    valid,
    timestamp,
  };
}

/*
 * =========================================================
 * EXTRAIR DADOS DO EVENTO
 * =========================================================
 *
 * O evento payment.succeeded contém os dados do pagamento.
 *
 * Aceitamos payment diretamente e também data.payment
 * para tornar o processamento mais tolerante sem alterar
 * a validação da assinatura.
 */

function extractPayment(event) {
  if (
    event &&
    event.payment &&
    typeof event.payment ===
      "object"
  ) {
    return event.payment;
  }

  if (
    event &&
    event.data &&
    event.data.payment &&
    typeof event.data.payment ===
      "object"
  ) {
    return event.data.payment;
  }

  if (
    event &&
    event.data &&
    typeof event.data ===
      "object" &&
    event.data.id &&
    event.data.reference
  ) {
    return event.data;
  }

  return null;
}

/*
 * =========================================================
 * EXTRAIR EVENT TYPE
 * =========================================================
 */

function extractEventType(event) {
  if (
    typeof event?.type ===
    "string"
  ) {
    return event.type;
  }

  if (
    typeof event?.event ===
    "string"
  ) {
    return event.event;
  }

  if (
    typeof event?.eventType ===
    "string"
  ) {
    return event.eventType;
  }

  return "";
}

/*
 * =========================================================
 * CHAMAR GENERATE-TICKET.JS
 * =========================================================
 */

async function generateTicket(
  orderReference
) {
  if (
    !SITE_URL ||
    !TICKET_GENERATION_SECRET
  ) {
    throw new Error(
      "SITE_URL ou TICKET_GENERATION_SECRET não configurado."
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

          "X-Ticket-Generation-Secret":
            TICKET_GENERATION_SECRET,
        },

        body: JSON.stringify({
          orderReference,
        }),
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
      data = {
        raw: text,
      };
    }
  }

  if (!response.ok) {
    const error =
      new Error(
        data?.message ||
          "Erro ao gerar bilhete."
      );

    error.status =
      response.status;

    error.data =
      data;

    throw error;
  }

  return data;
}

/*
 * =========================================================
 * HANDLER
 * =========================================================
 */

export default async function handler(
  req,
  res
) {
  /*
   * -------------------------------------------------------
   * SOMENTE POST
   * -------------------------------------------------------
   */

  if (
    req.method !== "POST"
  ) {
    return sendJson(
      res,
      405,
      {
        success: false,
        message:
          "Método não permitido.",
      }
    );
  }

  try {
    /*
     * -----------------------------------------------------
     * CONFIGURAÇÃO
     * -----------------------------------------------------
     */

    if (
      !PAGAR_WEBHOOK_SECRET
    ) {
      console.error(
        "PAGAR_WEBHOOK_SECRET ausente."
      );

      return sendJson(
        res,
        500,
        {
          success: false,
          message:
            "Webhook não configurado.",
        }
      );
    }

    /*
     * -----------------------------------------------------
     * EVENT ID
     * -----------------------------------------------------
     */

    const eventId =
      req.headers[
        "pagar-event-id"
      ];

    if (
      typeof eventId !==
        "string" ||
      !eventId.trim()
    ) {
      return sendJson(
        res,
        400,
        {
          success: false,
          message:
            "Pagar-Event-Id ausente.",
        }
      );
    }

    /*
     * -----------------------------------------------------
     * ASSINATURA
     * -----------------------------------------------------
     */

    const signatureHeader =
      req.headers[
        "pagar-signature"
      ];

    if (
      typeof signatureHeader !==
        "string" ||
      !signatureHeader
    ) {
      return sendJson(
        res,
        401,
        {
          success: false,
          message:
            "Assinatura ausente.",
        }
      );
    }

    /*
     * -----------------------------------------------------
     * RAW BODY
     * -----------------------------------------------------
     */

    const rawBody =
      await readRawBody(req);

    if (!rawBody.length) {
      return sendJson(
        res,
        400,
        {
          success: false,
          message:
            "Body vazio.",
        }
      );
    }

    /*
     * -----------------------------------------------------
     * VALIDAR HMAC
     * -----------------------------------------------------
     */

    const signature =
      verifyPagarSignature(
        rawBody,
        signatureHeader
      );

    if (!signature.valid) {
      console.error(
        "PAGAR WEBHOOK REJECTED:",
        signature.reason
      );

      return sendJson(
        res,
        401,
        {
          success: false,
          message:
            "Assinatura inválida.",
        }
      );
    }

    /*
     * -----------------------------------------------------
     * PARSE DO JSON
     * -----------------------------------------------------
     */

    let event;

    try {
      event =
        JSON.parse(
          rawBody.toString(
            "utf8"
          )
        );
    } catch {
      return sendJson(
        res,
        400,
        {
          success: false,
          message:
            "JSON inválido.",
        }
      );
    }

    /*
     * -----------------------------------------------------
     * EVENT TYPE
     * -----------------------------------------------------
     */

    const eventType =
      extractEventType(
        event
      );

    /*
     * -----------------------------------------------------
     * PAYMENT
     * -----------------------------------------------------
     */

    const payment =
      extractPayment(
        event
      );

    /*
     * -----------------------------------------------------
     * PRIMEIRO: REGISTRAR EVENTO
     * -----------------------------------------------------
     *
     * O event_id é UNIQUE.
     *
     * Se a Pagar repetir o mesmo webhook,
     * o segundo INSERT falhará com 409.
     */

    const eventRows =
      await supabaseRequest(
        "pagar_webhook_events",
        {
          method: "POST",

          headers: {
            Prefer:
              "return=representation,resolution=ignore-duplicates",
          },

          body: JSON.stringify({
            event_id:
              eventId.trim(),

            event_type:
              eventType || null,

            payment_id:
              payment?.id ||
              null,

            order_reference:
              payment?.reference ||
              null,

            payload:
              event,

            processing_status:
              "RECEIVED",
          }),
        }
      );

    /*
     * -----------------------------------------------------
     * EVENTO DUPLICADO
     * -----------------------------------------------------
     *
     * Com resolution=ignore-duplicates, uma repetição
     * retorna array vazio.
     */

    if (
      !Array.isArray(
        eventRows
      ) ||
      eventRows.length === 0
    ) {
      console.log(
        "PAGAR WEBHOOK DUPLICADO:",
        eventId
      );

      return sendJson(
        res,
        200,
        {
          success: true,
          duplicate: true,
          eventId,
        }
      );
    }

    /*
     * -----------------------------------------------------
     * EVENTOS QUE NÃO SÃO PAGAMENTO CONFIRMADO
     * -----------------------------------------------------
     */

    if (
      eventType !==
      "payment.succeeded"
    ) {
      await supabaseRequest(
        `pagar_webhook_events?event_id=eq.${encodeURIComponent(
          eventId.trim()
        )}`,
        {
          method: "PATCH",

          headers: {
            Prefer:
              "return=minimal",
          },

          body: JSON.stringify({
            processing_status:
              "IGNORED",

            processed_at:
              new Date().toISOString(),
          }),
        }
      );

      return sendJson(
        res,
        200,
        {
          success: true,
          ignored: true,
          eventType,
        }
      );
    }

    /*
     * -----------------------------------------------------
     * PAYMENT OBRIGATÓRIO
     * -----------------------------------------------------
     */

    if (!payment) {
      throw new Error(
        "payment não encontrado no evento."
      );
    }

    /*
     * -----------------------------------------------------
     * VALIDAR DADOS ESSENCIAIS
     * -----------------------------------------------------
     */

    const paymentId =
      typeof payment.id ===
      "string"
        ? payment.id.trim()
        : "";

    const orderReference =
      typeof payment.reference ===
      "string"
        ? payment.reference.trim()
        : "";

    const paymentStatus =
      typeof payment.status ===
      "string"
        ? payment.status
            .trim()
            .toUpperCase()
        : "";

    if (
      !paymentId ||
      !orderReference
    ) {
      throw new Error(
        "Pagamento sem id ou reference."
      );
    }

    /*
     * -----------------------------------------------------
     * CONFIRMAÇÃO FINANCEIRA
     * -----------------------------------------------------
     *
     * Mesmo sendo payment.succeeded, exigimos PAID.
     */

    if (
      paymentStatus !==
      "PAID"
    ) {
      await supabaseRequest(
        `pagar_webhook_events?event_id=eq.${encodeURIComponent(
          eventId.trim()
        )}`,
        {
          method: "PATCH",

          headers: {
            Prefer:
              "return=minimal",
          },

          body: JSON.stringify({
            processing_status:
              "WAITING_PAYMENT_STATUS",

            processed_at:
              new Date().toISOString(),
          }),
        }
      );

      return sendJson(
        res,
        200,
        {
          success: true,

          eventId,

          paymentStatus,

          message:
            "Pagamento ainda não está PAID.",
        }
      );
    }

    /*
     * -----------------------------------------------------
     * ENCONTRAR PEDIDO
     * -----------------------------------------------------
     */

    const orders =
      await supabaseRequest(
        `blackout_orders?order_reference=eq.${encodeURIComponent(
          orderReference
        )}&limit=1`,
        {
          method: "GET",
        }
      );

    if (
      !Array.isArray(
        orders
      ) ||
      orders.length === 0
    ) {
      throw new Error(
        `Pedido ${orderReference} não encontrado.`
      );
    }

    const order =
      orders[0];

    /*
     * -----------------------------------------------------
     * VALIDAÇÃO DE VALOR
     * -----------------------------------------------------
     *
     * O valor do webhook precisa corresponder ao valor
     * guardado no nosso banco.
     */

    const databaseAmount =
      Number(
        order.total_amount
      );

    const pagarAmount =
      Number(
        payment.amountMzn
      );

    if (
      !Number.isInteger(
        databaseAmount
      ) ||
      !Number.isInteger(
        pagarAmount
      ) ||
      databaseAmount !==
        pagarAmount
    ) {
      throw new Error(
        "O valor confirmado pela Pagar não corresponde ao valor do pedido."
      );
    }

    /*
     * -----------------------------------------------------
     * ATUALIZAR PEDIDO
     * -----------------------------------------------------
     */

    const updated =
      await supabaseRequest(
        `blackout_orders?order_reference=eq.${encodeURIComponent(
          orderReference
        )}`,
        {
          method: "PATCH",

          headers: {
            Prefer:
              "return=representation",
          },

          body: JSON.stringify({
            payment_status:
              "PAID",

            payment_id:
              paymentId,

            payment_reference:
              orderReference,

            paid_at:
              new Date().toISOString(),
          }),
        }
      );

    if (
      !Array.isArray(
        updated
      ) ||
      updated.length === 0
    ) {
      throw new Error(
        "Pedido não foi atualizado."
      );
    }

    /*
     * -----------------------------------------------------
     * GERAR BILHETE
     * -----------------------------------------------------
     */

    const ticket =
      await generateTicket(
        orderReference
      );

    /*
     * -----------------------------------------------------
     * MARCAR WEBHOOK COMO PROCESSADO
     * -----------------------------------------------------
     */

    await supabaseRequest(
      `pagar_webhook_events?event_id=eq.${encodeURIComponent(
        eventId.trim()
      )}`,
      {
        method: "PATCH",

        headers: {
          Prefer:
            "return=minimal",
        },

        body: JSON.stringify({
          processing_status:
            "PROCESSED",

          processed_at:
            new Date().toISOString(),
        }),
      }
    );

    /*
     * -----------------------------------------------------
     * RESPOSTA
     * -----------------------------------------------------
     */

    return sendJson(
      res,
      200,
      {
        success: true,

        eventId,

        eventType,

        paymentId,

        orderReference,

        paymentStatus:
          "PAID",

        ticket,
      }
    );

  } catch (error) {
    console.error(
      "PAGAR WEBHOOK ERROR:",
      error
    );

    /*
     * Não expor detalhes internos ao cliente/Pagar.
     */

    try {
      const eventId =
        req.headers[
          "pagar-event-id"
        ];

      if (
        typeof eventId ===
          "string" &&
        eventId
      ) {
        await supabaseRequest(
          `pagar_webhook_events?event_id=eq.${encodeURIComponent(
            eventId
          )}`,
          {
            method: "PATCH",

            headers: {
              Prefer:
                "return=minimal",
            },

            body: JSON.stringify({
              processing_status:
                "ERROR",

              error_message:
                String(
                  error?.message ||
                    "Erro desconhecido"
                ).slice(
                  0,
                  1000
                ),
            }),
          }
        );
      }
    } catch (
      loggingError
    ) {
      console.error(
        "WEBHOOK LOGGING ERROR:",
        loggingError
      );
    }

    return sendJson(
      res,
      500,
      {
        success: false,
        message:
          "Webhook recebido, mas não foi possível concluir o processamento.",
      }
    );
  }
      }
