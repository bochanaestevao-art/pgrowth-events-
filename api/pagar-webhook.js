import crypto from "node:crypto";

const WEBHOOK_SECRET = process.env.PAGAR_WEBHOOK_SECRET;

function sendJson(res, status, data) {
  return res.status(status).json(data);
}

function getHeader(req, name) {
  const value = req.headers?.[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function getRawBody(req) {
  // Vercel/Node pode disponibilizar o corpo bruto desta forma.
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (Buffer.isBuffer(req.rawBody)) {
    return req.rawBody;
  }

  if (typeof req.body === "string") {
    return Buffer.from(req.body, "utf8");
  }

  if (typeof req.rawBody === "string") {
    return Buffer.from(req.rawBody, "utf8");
  }

  // NÃO é ideal para validação criptográfica porque JSON.stringify
  // pode produzir um corpo diferente do originalmente recebido.
  throw new Error("Raw body não disponível.");
}

function verifyPagarWebhook(req, rawBody) {
  if (!WEBHOOK_SECRET) {
    throw new Error(
      "PAGAR_WEBHOOK_SECRET não configurado no servidor."
    );
  }

  const eventId = getHeader(req, "pagar-event-id");
  const signatureHeader =
    getHeader(req, "pagar-signature") || "";

  if (!eventId) {
    return {
      valid: false,
      reason: "Pagar-Event-Id ausente.",
    };
  }

  /*
   * Formato esperado:
   *
   * Pagar-Signature:
   * t=1720000000,v1=64-caracteres-hex
   */

  const parts = {};

  for (const part of signatureHeader.split(",")) {
    const separator = part.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    parts[key] = value;
  }

  const timestamp = parts.t;
  const receivedSignature = parts.v1;

  if (!timestamp || !receivedSignature) {
    return {
      valid: false,
      reason: "Assinatura Pagar inválida ou incompleta.",
    };
  }

  // Timestamp precisa ser somente numérico.
  if (!/^\d+$/.test(timestamp)) {
    return {
      valid: false,
      reason: "Timestamp inválido.",
    };
  }

  // A assinatura esperada é SHA-256 hexadecimal.
  if (!/^[a-f0-9]{64}$/i.test(receivedSignature)) {
    return {
      valid: false,
      reason: "Formato da assinatura inválido.",
    };
  }

  /*
   * A Pagar assina:
   *
   * timestamp + "." + rawBody
   */
  const signedPayload =
    timestamp +
    "." +
    rawBody.toString("utf8");

  const expectedSignature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(signedPayload)
    .digest("hex");

  /*
   * Evita comparação simples de strings para reduzir
   * risco de timing attack.
   */
  const receivedBuffer = Buffer.from(
    receivedSignature,
    "hex"
  );

  const expectedBuffer = Buffer.from(
    expectedSignature,
    "hex"
  );

  if (receivedBuffer.length !== expectedBuffer.length) {
    return {
      valid: false,
      reason: "Assinatura inválida.",
    };
  }

  const signatureMatches = crypto.timingSafeEqual(
    receivedBuffer,
    expectedBuffer
  );

  if (!signatureMatches) {
    return {
      valid: false,
      reason: "Assinatura inválida.",
    };
  }

  /*
   * Proteção contra replay.
   *
   * A documentação recomenda rejeitar eventos antigos.
   * Aqui usamos uma janela de 5 minutos.
   */
  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > 300
  ) {
    return {
      valid: false,
      reason: "Webhook fora da janela de 5 minutos.",
    };
  }

  return {
    valid: true,
    eventId,
  };
}

export default async function handler(req, res) {
  // --------------------------------------------------
  // SOMENTE POST
  // --------------------------------------------------

  if (req.method !== "POST") {
    return sendJson(res, 405, {
      success: false,
      message: "Método não permitido.",
    });
  }

  try {
    // ------------------------------------------------
    // 1. OBTER RAW BODY
    // ------------------------------------------------

    const rawBody = getRawBody(req);

    // ------------------------------------------------
    // 2. VALIDAR ASSINATURA
    // ------------------------------------------------

    const verification = verifyPagarWebhook(
      req,
      rawBody
    );

    if (!verification.valid) {
      console.warn(
        "PAGAR WEBHOOK REJEITADO:",
        verification.reason
      );

      return sendJson(res, 401, {
        success: false,
        message: "Webhook não autorizado.",
      });
    }

    const eventId = verification.eventId;

    // ------------------------------------------------
    // 3. LER JSON ORIGINAL
    // ------------------------------------------------

    let event;

    try {
      event = JSON.parse(
        rawBody.toString("utf8")
      );
    } catch {
      return sendJson(res, 400, {
        success: false,
        message: "JSON do webhook inválido.",
      });
    }

    // ------------------------------------------------
    // 4. IDENTIFICAR EVENTO
    // ------------------------------------------------

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

    const paymentStatus =
      String(
        payment.status ||
        ""
      ).toUpperCase();

    const reference =
      payment.reference ||
      event.reference ||
      null;

    console.log(
      "PAGAR WEBHOOK:",
      JSON.stringify({
        eventId,
        eventType,
        paymentId,
        reference,
        status: paymentStatus,
      })
    );

    // ------------------------------------------------
    // 5. IDEMPOTÊNCIA
    // ------------------------------------------------

    /*
     * IMPORTANTE:
     *
     * O Pagar-Event-Id deve ser guardado no Supabase
     * com UNIQUE.
     *
     * Exemplo:
     *
     * pagar_event_id = eventId
     *
     * Se o mesmo webhook chegar novamente, ele não
     * poderá gerar outro bilhete.
     *
     * Nesta etapa ainda não fazemos a gravação porque
     * o Supabase será ligado no próximo passo.
     */

    // ------------------------------------------------
    // 6. PAGAMENTO CONFIRMADO
    // ------------------------------------------------

    if (
      eventType === "payment.succeeded" ||
      paymentStatus === "PAID"
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
       * PRÓXIMO PASSO:
       *
       * 1. Encontrar o pedido no Supabase pela reference.
       * 2. Guardar paymentId.
       * 3. Guardar eventId.
       * 4. Confirmar que o pedido ainda não está PAID.
       * 5. Alterar o pedido para PAID.
       * 6. Gerar o número do bilhete.
       * 7. Gerar QR Code.
       * 8. Gerar PDF.
       * 9. Disponibilizar o bilhete ao comprador.
       */

      return sendJson(res, 200, {
        success: true,
        received: true,
        eventId,
        status: "PAID",
      });
    }

    // ------------------------------------------------
    // 7. PAGAMENTO FALHOU
    // ------------------------------------------------

    if (
      eventType === "payment.failed" ||
      paymentStatus === "FAILED"
    ) {
      console.log(
        "PAGAMENTO FALHOU:",
        {
          eventId,
          paymentId,
          reference,
        }
      );

      /*
       * PRÓXIMO PASSO:
       *
       * Atualizar o pedido no Supabase para FAILED.
       */

      return sendJson(res, 200, {
        success: true,
        received: true,
        eventId,
        status: "FAILED",
      });
    }

    // ------------------------------------------------
    // 8. OUTROS EVENTOS
    // ------------------------------------------------

    console.log(
      "EVENTO PAGAR RECEBIDO:",
      eventType
    );

    /*
     * Eventos desconhecidos ou não relacionados ao
     * pagamento não devem causar erro.
     */

    return sendJson(res, 200, {
      success: true,
      received: true,
      eventId,
      event: eventType,
    });

  } catch (error) {
    console.error(
      "PAGAR WEBHOOK ERROR:",
      error
    );

    return sendJson(res, 500, {
      success: false,
      message: "Erro interno ao processar webhook.",
    });
  }
}
```
