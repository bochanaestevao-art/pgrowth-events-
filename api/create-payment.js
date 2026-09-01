import crypto from "node:crypto";

const PAGAR_API_BASE_URL =
  process.env.PAGAR_API_BASE_URL || "https://api.pagar.co.mz/api/v1";

const PAGAR_API_KEY = process.env.PAGAR_API_KEY;
const PAGAR_SIGNING_SECRET = process.env.PAGAR_SIGNING_SECRET;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function sendJson(res, status, data) {
  return res.status(status).json(data);
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Credenciais do Supabase não configuradas.");
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();

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
        "Erro ao comunicar com o Supabase."
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

async function pagarPost(path, body, idempotencyKey) {
  if (!PAGAR_API_KEY || !PAGAR_SIGNING_SECRET) {
    throw new Error(
      "Credenciais da Pagar não configuradas no Vercel."
    );
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
      Authorization: `Bearer ${PAGAR_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-Pagar-Timestamp": timestamp,
      "X-Pagar-Nonce": nonce,
      "X-Pagar-Signature": `v1=${signature}`,
    },
    body: rawBody,
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(
      data?.message ||
        "Pedido rejeitado pela Pagar API."
    );

    error.code = data?.error;
    error.requestId = data?.requestId;

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
    return `258${value}`;
  }

  return value;
}

async function findOrder(reference) {
  const result = await supabaseRequest(
    `blackout_orders?order_reference=eq.${encodeURIComponent(
      reference
    )}&limit=1`,
    {
      method: "GET",
    }
  );

  return Array.isArray(result) && result.length
    ? result[0]
    : null;
}

async function createOrder(order) {
  const result = await supabaseRequest(
    "blackout_orders",
    {
      method: "POST",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify(order),
    }
  );

  return Array.isArray(result) ? result[0] : result;
}

async function updateOrderAfterPayment(
  reference,
  paymentId,
  paymentStatus
) {
  const body = {
    payment_reference: reference,
  };

  if (paymentId) {
    body.pagar_payment_id = paymentId;
  }

  if (paymentStatus) {
    body.payment_status = paymentStatus;
  }

  const result = await supabaseRequest(
    `blackout_orders?order_reference=eq.${encodeURIComponent(
      reference
    )}&payment_status=neq.PAID`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
    }
  );

  return Array.isArray(result) ? result[0] : null;
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

    const calculatedTotal = price * qty;

    if (calculatedTotal !== total) {
      return sendJson(res, 400, {
        success: false,
        message:
          "O valor total não corresponde à quantidade de bilhetes.",
      });
    }

    const reference =
      clean(orderReference) ||
      `PG-BLACKOUT-${Date.now()}-${crypto
        .randomBytes(3)
        .toString("hex")
        .toUpperCase()}`;

    /*
     * Se este pedido já existe:
     * - PAID/PROCESSING: não criar outro pagamento.
     * - FAILED/CANCELLED: permite nova tentativa.
     * - CREATED: continua a tentativa original.
     */
    const existing = await findOrder(reference);

    if (existing) {
      const existingStatus = String(
        existing.payment_status || ""
      ).toUpperCase();

      if (
        existingStatus === "PAID" ||
        existingStatus === "PROCESSING"
      ) {
        return sendJson(res, 200, {
          success: true,
          existing: true,
          orderReference: reference,
          paymentId:
            existing.pagar_payment_id || null,
          status: existingStatus,
          amountMzn: Number(existing.total_amount),
          currency: "MZN",
          method: "EMOLA",
          message:
            existingStatus === "PAID"
              ? "Pagamento já confirmado."
              : "Pagamento já está em processamento.",
        });
      }
    }

    /*
     * PRIMEIRO criamos o pedido.
     * Assim o webhook nunca chega antes do pedido existir.
     */
    if (!existing) {
      await createOrder({
        order_reference: reference,
        full_name: name,
        phone: contact,
        bairro: neighborhood,
        ticket_type: type,
        ticket_lot: lot,
        ticket_price: String(price),
        quantity: String(qty),
        total_amount: String(calculatedTotal),
        payment_method: "EMOLA",
        payment_status: "CREATED",
        payment_reference: reference,
        pagar_payment_id: "",
        created_at: new Date().toISOString(),
        ticket_code: "",
        ticket_status: "",
        qr_data: "",
        pdf_path: "",
        paid_at: "",
      });
    }

    const paymentBody = {
      reference,
      title: "BLACK OUT — AMAPIANO EDITION",
      description: `${qty} bilhete(s) ${type} — ${lot}`,
      amountMzn: calculatedTotal,
      method: "EMOLA",
      payerPhone: contact,
    };

    const idempotencyKey =
      existing &&
      ["FAILED", "CANCELLED"].includes(
        String(existing.payment_status || "").toUpperCase()
      )
        ? `payment:${reference}:${Date.now()}`
        : `payment:${reference}`;

    const result = await pagarPost(
      "/payments",
      paymentBody,
      idempotencyKey
    );

    const payment = result?.payment || result;

    /*
     * A Pagar pode devolver "id" ou "paymentId".
     * Aceitamos os dois formatos.
     */
    const paymentId =
      payment?.id ||
      payment?.paymentId ||
      null;

    const paymentStatus =
      String(payment?.status || "PROCESSING").toUpperCase();

    /*
     * O webhook pode ter marcado PAID enquanto esta
     * requisição estava em andamento.
     *
     * Esta atualização nunca sobrescreve PAID.
     */
    await updateOrderAfterPayment(
      reference,
      paymentId,
      paymentStatus === "PAID"
        ? "PAID"
        : "PROCESSING"
    );

    return sendJson(res, 202, {
      success: true,
      orderReference: reference,
      paymentId,
      status: paymentStatus,
      amountMzn: calculatedTotal,
      currency: "MZN",
      method: "EMOLA",
      message:
        paymentStatus === "PAID"
          ? "Pagamento confirmado. O bilhete será emitido."
          : "Pedido de pagamento enviado. Autorize o pagamento no e-Mola.",
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
