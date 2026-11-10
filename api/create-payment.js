import crypto from "node:crypto";

const PAGAR_API_BASE_URL =
  process.env.PAGAR_API_BASE_URL || "https://api.pagar.co.mz/api/v1";

const PAGAR_API_KEY = process.env.PAGAR_API_KEY;
const PAGAR_SIGNING_SECRET = process.env.PAGAR_SIGNING_SECRET;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

/*
 * ============================================================
 * CATÁLOGO OFICIAL DE BILHETES
 * ============================================================
 *
 * O preço usado no pagamento NÃO vem do navegador.
 * O backend é a fonte de verdade.
 */

async function getOfficialTicket(type, lot) {
  const normalizedType = normalizeTicketType(type);
  const normalizedLot = normalizeLot(lot);

  const path =
    `blackout_tickets` +
    `?ticket_type=eq.${encodeURIComponent(normalizedType)}` +
    `&ticket_lot=eq.${encodeURIComponent(normalizedLot)}` +
    `&status=eq.ACTIVE` +
    `&select=id,ticket_type,ticket_lot,price,starts_at,ends_at,status` +
    `&limit=1`;

  const data = await supabaseRequest(path, {
    method: "GET",
  });

  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  const ticket = data[0];

  return {
    id: ticket.id,
    type: normalizeTicketType(ticket.ticket_type),
    lot: normalizeLot(ticket.ticket_lot),
    price: Number(ticket.price),
    start: ticket.starts_at,
    end: ticket.ends_at,
    status: ticket.status,
  };
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeTicketType(value) {
  const normalized = clean(value).toUpperCase();

  if (normalized === "NORMAL") {
    return "NORMAL";
  }

  if (normalized === "VIP") {
    return "VIP";
  }

  return normalized;
}

function normalizeLot(value) {
  return clean(value)
    .toUpperCase()
    .replace(/\s+/g, " ");
}


function isTicketAvailable(ticket) {
  if (!ticket) {
    return false;
  }

   const now = Date.now();
  const start = new Date(ticket.start).getTime();
  const end = new Date(ticket.end).getTime();

  return now >= start && now <= end;
}

function sendJson(res, status, data) {
  return res.status(status).json(data);
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Credenciais do Supabase não configuradas.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    }
  );

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

  const nonce = crypto
    .randomBytes(18)
    .toString("base64url");

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

  const signature = "v1=" + crypto
    .createHmac("sha256", PAGAR_SIGNING_SECRET)
    .update(canonical)
    .digest("hex");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PAGAR_API_KEY}`,
      "Pagar-Api-Key": PAGAR_API_KEY,
      "x-pagar-timestamp": timestamp,
      "x-pagar-nonce": nonce,
      "x-pagar-signature": signature,
      "Idempotency-Key": idempotencyKey,
    },
    body: rawBody,
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
        data?.error ||
        `Erro da Pagar: HTTP ${response.status}`
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

async function findOrder(reference) {
  const data = await supabaseRequest(
    `blackout_orders?order_reference=eq.${encodeURIComponent(
      reference
    )}&select=*&limit=1`,
    {
      method: "GET",
    }
  );

  return Array.isArray(data) && data.length > 0
    ? data[0]
    : null;
}

async function createOrder(order) {
  const data = await supabaseRequest(
    "blackout_orders",
    {
      method: "POST",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify(order),
    }
  );

  return Array.isArray(data) ? data[0] : data;
}

async function updateOrder(reference, patch) {
  const data = await supabaseRequest(
    `blackout_orders?order_reference=eq.${encodeURIComponent(
      reference
    )}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    }
  );

  return Array.isArray(data) ? data[0] : data;
}

async function main(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, {
      success: false,
      message: "Método não permitido.",
    });
  }

  try {
    if (!PAGAR_API_KEY || !PAGAR_SIGNING_SECRET) {
      return sendJson(res, 500, {
        success: false,
        message:
          "As credenciais da Pagar não estão configuradas no Vercel.",
      });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return sendJson(res, 500, {
        success: false,
        message:
          "As credenciais do Supabase não estão configuradas no Vercel.",
      });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const fullName = clean(
      body.fullName || body.name || body.nome
    );

    const phone = clean(
      body.phone || body.payerPhone || body.telefone
    );

    const neighborhood = clean(
      body.bairro ||
        body.neighborhood ||
        body.location
    );

    const type = normalizeTicketType(
      body.ticketType ||
        body.type ||
        body.ticket_type
    );

    const lot = normalizeLot(
      body.ticketLot ||
        body.lot ||
        body.ticket_lot
    );

    const method = clean(
  body.paymentMethod ||
    body.method ||
    body.payment_method ||
    "EMOLA"
).toUpperCase();

    const orderReference = "";

    /*
     * O frontend ainda envia estes campos.
     * Eles são aceitos somente para compatibilidade.
     * NÃO serão usados como fonte de preço.
     */
    const browserPrice = Number(
      body.ticketPrice ??
        body.price ??
        body.ticket_price
    );

    const browserTotal = Number(
      body.totalAmount ??
        body.total ??
        body.total_amount
    );

    const qty = Number(
      body.quantity ??
        body.qty ??
        1
    );

    if (!fullName) {
      return sendJson(res, 400, {
        success: false,
        message: "Informe o nome completo.",
      });
    }

    if (!phone) {
      return sendJson(res, 400, {
        success: false,
        message: "Informe o número de telefone.",
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
        message:
          "Selecione o tipo de bilhete e o lote.",
      });
    }

    if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
      return sendJson(res, 400, {
        success: false,
        message:
          "A quantidade deve estar entre 1 e 10.",
      });
    }

    if (!["EMOLA", "MPESA"].includes(method)) {
  return sendJson(res, 400, {
    success: false,
    message: "Método de pagamento inválido.",
  });
    }

    /*
     * ========================================================
     * PREÇO OFICIAL DO BACKEND
     * ========================================================
     */

    const officialTicket = await getOfficialTicket(type, lot);

    if (!officialTicket) {
      return sendJson(res, 400, {
        success: false,
        message:
          "O tipo de bilhete ou lote selecionado não é válido.",
      });
    }

    if (!isTicketAvailable(officialTicket)) {
      return sendJson(res, 400, {
        success: false,
        message:
          `O ${officialTicket.lot} para ${officialTicket.type} não está disponível neste momento.`,
      });
    }

    const price = Number(officialTicket.price);

    const calculatedTotal = price * qty;

    /*
     * Apenas registra no log se o navegador enviou valores
     * diferentes. O servidor continua usando os valores oficiais.
     */
    if (
      Number.isInteger(browserPrice) &&
      browserPrice !== price
    ) {
      console.warn(
        "Preço enviado pelo navegador diferente do preço oficial.",
        {
          browserPrice,
          officialPrice: price,
          type,
          lot,
        }
      );
    }

    if (
      Number.isInteger(browserTotal) &&
      browserTotal !== calculatedTotal
    ) {
      console.warn(
        "Total enviado pelo navegador diferente do total oficial.",
        {
          browserTotal,
          calculatedTotal,
          qty,
          price,
        }
      );
    }

    const reference =
      orderReference ||
      `BMS-2026-${Date.now()}-${crypto
        .randomBytes(3)
        .toString("hex")
        .toUpperCase()}`;

    /*
     * ========================================================
     * VERIFICAR PEDIDO EXISTENTE
     * ========================================================
     */

    const existing = await findOrder(reference);

    if (existing) {
      const existingType = normalizeTicketType(
        existing.ticket_type
      );

      const existingLot = normalizeLot(
        existing.ticket_lot
      );

      const existingPrice = Number(
        existing.ticket_price
      );

      const existingQuantity = Number(
        existing.quantity
      );

      const existingTotal = Number(
        existing.total_amount
      );

      /*
       * O mesmo order_reference não pode ser reutilizado
       * para outro bilhete, preço ou quantidade.
       */
      if (
        existingType !== type ||
        existingLot !== lot ||
        existingPrice !== price ||
        existingQuantity !== qty ||
        existingTotal !== calculatedTotal
      ) {
        return sendJson(res, 409, {
          success: false,
          message:
            "A referência do pedido já está associada a outros dados.",
        });
      }

      /*
       * Se já está pago, não cria outro pagamento.
       */
      if (existing.payment_status === "PAID") {
        return sendJson(res, 200, {
          success: true,
          alreadyPaid: true,
          orderReference: reference,
          paymentStatus: "PAID",
          paymentReference:
            existing.payment_reference || null,
          paymentId:
            existing.pagar_payment_id || null,
          ticketCode:
            existing.ticket_code || null,
          pdfPath:
            existing.pdf_path || null,
        });
      }

      /*
       * Se está PROCESSING, devolve o pedido atual.
       */
      if (existing.payment_status === "PROCESSING") {
        return sendJson(res, 200, {
          success: true,
          alreadyProcessing: true,
          orderReference: reference,
          paymentStatus: "PROCESSING",
          paymentReference:
            existing.payment_reference || null,
          paymentId:
            existing.pagar_payment_id || null,
        });
      }

      /*
       * FAILED/CANCELLED pode ser tentado novamente.
       */
    } else {
      /*
       * ======================================================
       * CRIAR PEDIDO NO SUPABASE
       * ======================================================
       */

      await createOrder({
        order_reference: reference,
        full_name: fullName,
        phone,
        bairro: neighborhood,
        ticket_type: type,
        ticket_lot: lot,
        ticket_price: price,
        quantity: qty,
        total_amount: calculatedTotal,
        payment_method: method,
        payment_status: "CREATED",
        payment_reference: reference,
      });
    }

    /*
     * ========================================================
     * CRIAR PAGAMENTO NA PAGAR
     * ========================================================
     */

    const idempotencyKey =
  `beira-muscle-show-${reference}`;

    const paymentBody = {
  amountMzn: calculatedTotal,
  method,
  payerPhone: phone,
  title: "BEIRA MUSCLE SHOW — TREINO HÍBRIDO",
  description:
    `BEIRA MUSCLE SHOW — TREINO HÍBRIDO | ${type} | ${lot} | ${qty} bilhete(s)`,
  reference,
};

    const pagarResponse = await pagarPost(
      "/payments",
      paymentBody,
      idempotencyKey
    );

    const payment =
      pagarResponse?.payment ||
      pagarResponse;

    const paymentId =
      payment?.id ||
      payment?.paymentId ||
      null;

    const paymentReference =
      payment?.reference ||
      reference;

    const paymentStatus =
      payment?.status ||
      "PROCESSING";

    /*
     * ========================================================
     * ATUALIZAR PEDIDO
     * ========================================================
     *
     * Nunca sobrescrever PAID com PROCESSING.
     */

    const currentOrder = await findOrder(reference);

    if (
      currentOrder &&
      currentOrder.payment_status === "PAID"
    ) {
      return sendJson(res, 200, {
        success: true,
        alreadyPaid: true,
        orderReference: reference,
        paymentStatus: "PAID",
        paymentReference:
          currentOrder.payment_reference ||
          paymentReference,
        paymentId:
          currentOrder.pagar_payment_id ||
          paymentId,
        ticketCode:
          currentOrder.ticket_code || null,
        pdfPath:
          currentOrder.pdf_path || null,
      });
    }

    await updateOrder(reference, {
      payment_status:
        paymentStatus === "PAID"
          ? "PAID"
          : "PROCESSING",
      payment_reference:
        paymentReference,
      pagar_payment_id:
        paymentId,
    });

    /*
     * ========================================================
     * RESPOSTA
     * ========================================================
     */

    return sendJson(res, 200, {
      success: true,
      orderReference: reference,
      paymentStatus:
        paymentStatus === "PAID"
          ? "PAID"
          : "PROCESSING",
      paymentReference,
      paymentId,
      amountMzn: calculatedTotal,
      ticketType: type,
      ticketLot: lot,
      ticketPrice: price,
      quantity: qty,
      totalAmount: calculatedTotal,
    });
  } catch (error) {
    console.error(
      "CREATE PAYMENT ERROR:",
      error
    );

    /*
     * Se conseguimos identificar uma referência,
     * tentamos marcar o pedido como FAILED.
     */
    try {
      const body =
        typeof req.body === "string"
          ? JSON.parse(req.body)
          : req.body || {};

      const reference = clean(
        body.orderReference ||
          body.order_reference ||
          body.reference
      );

      if (reference) {
        const existing = await findOrder(
          reference
        );

        /*
         * Não alterar um pedido que já esteja PAID.
         */
        if (
          existing &&
          existing.payment_status !== "PAID"
        ) {
          await updateOrder(reference, {
            payment_status: "FAILED",
          });
        }
      }
    } catch (updateError) {
      console.error(
        "Erro ao atualizar pedido após falha:",
        updateError
      );
    }

    const status =
      Number.isInteger(error?.status) &&
      error.status >= 400 &&
      error.status < 600
        ? error.status
        : 500;

    return sendJson(res, status, {
      success: false,
      message:
        error?.message ||
        "Não foi possível iniciar o pagamento.",
      details:
        process.env.NODE_ENV === "development"
          ? error?.data || null
          : undefined,
    });
  }
}

export default main;