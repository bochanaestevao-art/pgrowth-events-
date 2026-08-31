import crypto from "node:crypto";

const PAGAR_API_BASE_URL =
  process.env.PAGAR_API_BASE_URL || "https://api.pagar.co.mz/api/v1";

const PAGAR_API_KEY = process.env.PAGAR_API_KEY;
const PAGAR_SIGNING_SECRET = process.env.PAGAR_SIGNING_SECRET;

function sendJson(res, status, data) {
  res.status(status).json(data);
}

async function pagarPost(path, body, idempotencyKey) {
  if (!PAGAR_API_KEY || !PAGAR_SIGNING_SECRET) {
    throw new Error("Credenciais da Pagar não configuradas no Vercel.");
  }

  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(18).toString("base64url");

  const rawBody = JSON.stringify(body);

  const bodyHash = crypto
    .createHash("sha256")
    .update(rawBody)
    .digest("hex");

  const url = PAGAR_API_BASE_URL + path;
  const canonicalPath = new URL(url).pathname;

  const canonical = [
    timestamp,
    nonce,
    "POST",
    canonicalPath,
    bodyHash,
  ].join("\n");

  const signature = crypto
    .createHmac("sha256", PAGAR_SIGNING_SECRET)
    .update(canonical)
    .digest("hex");

  const response = await fetch(url, {
    method: "POST",

    headers: {
      Authorization: "Bearer " + PAGAR_API_KEY,
      "Content-Type": "application/json",

      "Idempotency-Key": idempotencyKey,

      "X-Pagar-Timestamp": timestamp,
      "X-Pagar-Nonce": nonce,
      "X-Pagar-Signature": "v1=" + signature,
    },

    body: rawBody,
  });

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(
      data.message || "Pedido rejeitado pela Pagar API"
    );

    error.code = data.error;
    error.requestId = data.requestId;

    throw error;
  }

  return data;
}

function clean(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizePhone(phone) {
  let value = clean(phone).replace(/\s+/g, "");

  if (value.startsWith("+258")) {
    value = value.substring(1);
  }

  if (value.startsWith("258")) {
    return value;
  }

  if (/^8[2-7]\d{7}$/.test(value)) {
    return "258" + value;
  }

  return value;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, {
      success: false,
      message: "Método não permitido.",
    });
  }

  try {
    const {
      orderReference,
      fullName,
      phone,
      bairro,
      ticketType,
      ticketLot,
      ticketPrice,
      quantity,
      totalAmount,
      paymentMethod,
    } = req.body || {};

    // -----------------------------
    // VALIDAÇÃO BÁSICA
    // -----------------------------

    const name = clean(fullName);
    const contact = normalizePhone(phone);
    const neighborhood = clean(bairro);
    const type = clean(ticketType);
    const lot = clean(ticketLot);
    const method = clean(paymentMethod).toUpperCase();

    const qty = Number(quantity);
    const price = Number(ticketPrice);
    const total = Number(totalAmount);

    if (!name || name.length < 3) {
      return sendJson(res, 400, {
        success: false,
        message: "Informe o nome completo.",
      });
    }

    if (!contact) {
      return sendJson(res, 400, {
        success: false,
        message: "Informe um número de contacto válido.",
      });
    }

    if (!neighborhood) {
      return sendJson(res, 400, {
        success: false,
        message: "Informe o bairro.",
      });
    }

    if (!type || !lot) {
      return sendJson(res, 400, {
        success: false,
        message: "Selecione o bilhete e o lote.",
      });
    }

    if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
      return sendJson(res, 400, {
        success: false,
        message: "A quantidade deve estar entre 1 e 10.",
      });
    }

    if (!Number.isInteger(price) || price <= 0) {
      return sendJson(res, 400, {
        success: false,
        message: "Preço de bilhete inválido.",
      });
    }

    if (!Number.isInteger(total) || total <= 0) {
      return sendJson(res, 400, {
        success: false,
        message: "Valor total inválido.",
      });
    }

    if (method !== "EMOLA") {
      return sendJson(res, 400, {
        success: false,
        message: "Neste momento o pagamento disponível é e-Mola.",
      });
    }

    // -----------------------------
    // VERIFICAÇÃO DO TOTAL
    // -----------------------------

    const calculatedTotal = price * qty;

    if (calculatedTotal !== total) {
      return sendJson(res, 400, {
        success: false,
        message: "O valor total não corresponde à quantidade de bilhetes.",
      });
    }

    // -----------------------------
    // REFERÊNCIA
    // -----------------------------

    const reference =
      clean(orderReference) ||
      `PG-BLACKOUT-${Date.now()}`;

    // -----------------------------
    // PAGAR API
    // -----------------------------

    const paymentBody = {
      reference,

      title: "BLACK OUT — AMAPIANO EDITION",

      description:
        `${qty} bilhete(s) ${type} — ${lot}`,

      amountMzn: calculatedTotal,

      method: "EMOLA",

      payerPhone: contact,
    };

    const idempotencyKey = "payment:" + reference;

    const result = await pagarPost(
      "/payments",
      paymentBody,
      idempotencyKey
    );

    const payment = result.payment;

    return sendJson(res, 202, {
      success: true,

      orderReference: reference,

      paymentId: payment?.id || null,

      status: payment?.status || "PROCESSING",

      amountMzn: calculatedTotal,

      currency: "MZN",

      method: "EMOLA",

      message:
        "Pedido de pagamento enviado. Autorize o pagamento no e-Mola.",
    });

  } catch (error) {
    console.error("PAGAR ERROR:", error);

    return sendJson(res, 500, {
      success: false,
      message:
        "Não foi possível iniciar o pagamento. Tente novamente.",
    });
  }
      }
