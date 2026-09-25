import crypto from "crypto";

export const config = {
  api: {
    bodyParser: true,
  },
};

function sendJson(res, status, data) {
  return res.status(status).json(data);
}

function getEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Variável de ambiente ausente: ${name}`);
  }

  return value;
}

function timingSafeEqualString(a, b) {
  if (!a || !b) return false;

  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));

  if (aa.length !== bb.length) return false;

  return crypto.timingSafeEqual(aa, bb);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};

  for (const part of header.split(";")) {
    const index = part.indexOf("=");

    if (index === -1) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }

  return cookies;
}

function verifyBarSession(req) {
  const cookies = parseCookies(req);
  const token = cookies.bar_session;

  if (!token) return null;

  const secret = String(
  process.env.BAR_SESSION_SECRET || ""
).trim();

  if (!secret) {
    throw new Error("BAR_SESSION_SECRET não configurado");
  }

  const parts = token.split(".");

  if (parts.length !== 2) return null;

  const payload = parts[0];
  const suppliedSignature = parts[1];

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  if (
    !timingSafeEqualString(
      suppliedSignature,
      expectedSignature
    )
  ) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );

    if (!decoded || !decoded.staff_id) {
      return null;
    }

    if (
  decoded.exp &&
  Math.floor(Date.now() / 1000) > Number(decoded.exp)
) {
  return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

function getSupabaseConfig() {
  return {
    url: getEnv("SUPABASE_URL").replace(/\/+$/, ""),
    key: getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

async function supabaseRequest(path, options = {}) {
  const {
    url,
    key,
  } = getSupabaseConfig();

  const response = await fetch(
    `${url}${path}`,
    {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
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
      typeof data === "string"
        ? data
        : data?.message ||
          data?.error_description ||
          data?.hint ||
          data?.details ||
          `Supabase HTTP ${response.status}`
    );

    error.status = response.status;
    error.details = data;

    throw error;
  }

  return data;
}

function normalizeAmount(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return null;
  }

  if (amount <= 0) {
    return null;
  }

  return Math.round(amount * 100) / 100;
}

function normalizePaymentMethod(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeShortCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getParticipantPhone(participant, requestedPhone) {
  const phone = String(
    requestedPhone ||
      participant?.phone ||
      ""
  ).trim();

  return phone;
}

function generateTopupReference(
  eventId,
  staffId
) {
  const eventPart = String(eventId)
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 12);

  const staffPart = String(staffId || "STAFF")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8);

  const randomPart = crypto
    .randomBytes(8)
    .toString("hex");

  return [
    "BAR-TOPUP",
    eventPart,
    staffPart,
    Date.now(),
    randomPart,
  ].join("-");
}

function generateIdempotencyKey(reference) {
  return `bar-topup-${reference}`;
}

function getPagarConfig() {
  return {
    baseUrl: getEnv(
      "PAGAR_API_BASE_URL"
    ).replace(/\/+$/, ""),
    apiKey: getEnv("PAGAR_API_KEY"),
    signingSecret: getEnv(
      "PAGAR_SIGNING_SECRET"
    ),
  };
}

async function pagarPost(path, body, idempotencyKey) {
  const {
    baseUrl,
    apiKey,
    signingSecret,
  } = getPagarConfig();

  const timestamp = Date.now().toString();

  const nonce = crypto
    .randomBytes(18)
    .toString("base64url");

  const rawBody = JSON.stringify(body);

  const bodyHash = crypto
    .createHash("sha256")
    .update(rawBody)
    .digest("hex");

  const url = `${baseUrl}${path}`;
  const canonicalPath = new URL(url).pathname;

  const canonical = [
    timestamp,
    nonce,
    "POST",
    canonicalPath,
    bodyHash,
  ].join("\n");

  const signature = crypto
    .createHmac("sha256", signingSecret)
    .update(canonical)
    .digest("hex");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Pagar-Api-Key": apiKey,
      "X-Pagar-Timestamp": timestamp,
      "X-Pagar-Nonce": nonce,
      "X-Pagar-Signature": `v1=${signature}`,
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
      typeof data === "string"
        ? data
        : data?.message ||
          data?.error ||
          data?.details ||
          `Pagar HTTP ${response.status}`
    );

    error.status = response.status;
    error.details = data;

    throw error;
  }

  return data;
}
function extractPaymentId(payment) {
  return (
    payment?.id ||
    payment?.payment?.id ||
    payment?.payment_id ||
    payment?.paymentId ||
    payment?.data?.id ||
    payment?.data?.payment_id ||
    payment?.data?.payment?.id ||
    null
  );
}

function extractPaymentStatus(payment) {
  return String(
    payment?.status ||
      payment?.payment?.status ||
      payment?.payment_status ||
      payment?.paymentStatus ||
      payment?.data?.status ||
      payment?.data?.payment?.status ||
      ""
  ).toUpperCase();
}

async function getEvent(eventId) {
  const rows =
    await supabaseRequest(
      `/rest/v1/events?id=eq.${encodeURIComponent(
        eventId
      )}&select=id,name,description,starts_at,ends_at,status,currency,created_at,closed_at,closed_by&limit=1`
    );

  return Array.isArray(rows)
    ? rows[0] || null
    : null;
}

async function getParticipant(
  eventId,
  shortCode
) {
  const rows =
    await supabaseRequest(
      `/rest/v1/event_participants?event_id=eq.${encodeURIComponent(
        eventId
      )}&short_code=eq.${encodeURIComponent(
        shortCode
      )}&status=eq.ACTIVE&select=id,event_id,full_name,phone,short_code,status,created_at&limit=1`
    );

  return Array.isArray(rows)
    ? rows[0] || null
    : null;
}

async function getWallet(
  eventId,
  participantId
) {
  const rows =
    await supabaseRequest(
      `/rest/v1/wallet_accounts?event_id=eq.${encodeURIComponent(
        eventId
      )}&participant_id=eq.${encodeURIComponent(
        participantId
      )}&status=eq.ACTIVE&select=id,event_id,participant_id,balance,status,created_at,closed_at&limit=1`
    );

  return Array.isArray(rows)
    ? rows[0] || null
    : null;
}

async function getProducts(eventId) {
  return supabaseRequest(
    `/rest/v1/bar_products?event_id=eq.${encodeURIComponent(
      eventId
    )}&status=eq.ACTIVE&select=*&order=name.asc`
  );
}

async function getFiscalSettings(
  eventId
) {
  const rows =
    await supabaseRequest(
      `/rest/v1/event_fiscal_settings?event_id=eq.${encodeURIComponent(
        eventId
      )}&select=*&limit=1`
    );

  return Array.isArray(rows)
    ? rows[0] || null
    : null;
}

async function getWalletSettings(
  eventId
) {
  const rows =
    await supabaseRequest(
      `/rest/v1/wallet_settings?event_id=eq.${encodeURIComponent(
        eventId
      )}&select=id,event_id,min_topup,max_topup,currency,topup_enabled,created_at,topup_min_amount,topup_max_amount&limit=1`
    );

  return Array.isArray(rows)
    ? rows[0] || null
    : null;
}

function validateTopupSettings(
  amount,
  settings
) {
  if (!settings) {
    throw new Error(
      "WALLET_SETTINGS_NOT_FOUND"
    );
  }

  if (settings.topup_enabled === false) {
    throw new Error(
      "TOPUP_DISABLED"
    );
  }

  const minimum =
    settings.topup_min_amount ??
    settings.min_topup;

  const maximum =
    settings.topup_max_amount ??
    settings.max_topup;

  if (
    minimum !== null &&
    minimum !== undefined &&
    amount < Number(minimum)
  ) {
    throw new Error(
      "BELOW_MIN_TOPUP"
    );
  }

  if (
    maximum !== null &&
    maximum !== undefined &&
    amount > Number(maximum)
  ) {
    throw new Error(
      "ABOVE_MAX_TOPUP"
    );
  }
}

async function processCashTopup({
  eventId,
  shortCode,
  amount,
  staffId,
  description,
}) {
  const reference =
  `BAR-CASH-${String(eventId)}-${String(staffId || "SYSTEM")}-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

  return supabaseRequest(
    "/rest/v1/rpc/process_wallet_topup",
    {
      method: "POST",
      body: JSON.stringify({
        p_event_id: eventId,
        p_short_code: shortCode,
        p_amount: amount,
        p_payment_reference: reference,
        p_staff_id: staffId || null,
        p_description: description || "Recarga CASH",
        p_payment_id: null,
        p_payment_method: "CASH",
      }),
    }
  );
}

async function createPendingElectronicTopup({
  eventId,
  participantId,
  walletId,
  amount,
  reference,
  paymentMethod,
  staffId,
  description,
}) {
  const rows =
    await supabaseRequest(
      "/rest/v1/wallet_topups",
      {
        method: "POST",
        headers: {
          Prefer:
            "return=representation",
        },
        body: JSON.stringify({
          event_id: eventId,
          wallet_id: walletId,
          participant_id:
            participantId,
          amount,
          payment_status:
            "PENDING",
          payment_reference:
            reference,
          payment_id: null,
          payment_method:
            paymentMethod,
          staff_id:
            staffId || null,
          description:
            description || null,
        }),
      }
    );

  if (
    !Array.isArray(rows) ||
    !rows[0]
  ) {
    throw new Error(
      "TOPUP_CREATION_FAILED"
    );
  }

  return rows[0];
}

async function updatePendingTopupPayment({
  reference,
  paymentId,
}) {
  await supabaseRequest(
    `/rest/v1/wallet_topups?payment_reference=eq.${encodeURIComponent(
      reference
    )}&payment_status=eq.PENDING`,
    {
      method: "PATCH",
      headers: {
        Prefer:
          "return=minimal",
      },
      body: JSON.stringify({
        payment_id:
          paymentId || null,
      }),
    }
  );
}

async function markTopupFailed(
  reference,
  description
) {
  await supabaseRequest(
    `/rest/v1/wallet_topups?payment_reference=eq.${encodeURIComponent(
      reference
    )}&payment_status=eq.PENDING`,
    {
      method: "PATCH",
      headers: {
        Prefer:
          "return=minimal",
      },
      body: JSON.stringify({
        payment_status:
          "FAILED",
        description:
          description || null,
      }),
    }
  );
}

async function processElectronicTopup({
  eventId,
  participant,
  wallet,
  amount,
  paymentMethod,
  staffId,
  phone,
  description,
}) {
  const payerPhone =
    getParticipantPhone(
      participant,
      phone
    );

  if (!payerPhone) {
    throw new Error(
      "PARTICIPANT_PHONE_REQUIRED"
    );
  }

  const reference =
    generateTopupReference(
      eventId,
      staffId
    );

  await createPendingElectronicTopup({
    eventId,
    participantId:
      participant.id,
    walletId: wallet.id,
    amount,
    reference,
    paymentMethod,
    staffId,
    description,
  });

  try {
    const payment =
      await pagarPost(
        "/payments",
        {
          amountMzn: amount,
          method:
            paymentMethod,
          payerPhone,
          title:
            "BLACK OUT — RECARGA DE CARTEIRA",
          description:
            description ||
            `BLACK OUT — Recarga ${paymentMethod} | ${participant.full_name} | ${reference}`,
          reference,
        },
        generateIdempotencyKey(
          reference
        )
      );

    const paymentId =
      extractPaymentId(
        payment
      );

    const paymentStatus =
      extractPaymentStatus(
        payment
      );

    await updatePendingTopupPayment({
      reference,
      paymentId,
    });

    return {
      success: true,
      operation:
        "TOPUP_PAYMENT",
      status:
        "PENDING",
      payment_status:
        paymentStatus ||
        "PENDING",
      payment_reference:
        reference,
      payment_id:
        paymentId,
      payment_method:
        paymentMethod,
      amount,
      participant_id:
        participant.id,
      wallet_id:
        wallet.id,
      message:
        "Recarga criada. O saldo será creditado somente após a confirmação do pagamento.",
    };
  } catch (error) {
    try {
      await markTopupFailed(
        reference,
        `Falha ao criar pagamento Pagar: ${error.message}`
      );
    } catch (markError) {
      console.error(
        "Falha ao marcar TOPUP como FAILED:",
        markError
      );
    }

    throw error;
  }
}

async function processSale({
  eventId,
  shortCode,
  items,
  staffId,
}) {
  return supabaseRequest(
    "/rest/v1/rpc/process_bar_sale",
    {
      method: "POST",
      body: JSON.stringify({
        p_event_id: eventId,
        p_short_code:
          shortCode,
        p_items: items,
        p_staff_id:
          staffId || null,
      }),
    }
  );
}

function mapErrorMessage(error) {
  const message =
    String(
      error?.message || ""
    );

  const known = {
    EVENT_CLOSED:
      "O evento está fechado.",
    PARTICIPANT_NOT_FOUND:
      "Participante não encontrado ou inativo.",
    WALLET_NOT_FOUND:
      "Carteira do participante não encontrada.",
    WALLET_NOT_ACTIVE:
      "A carteira do participante não está ativa.",
    INVALID_AMOUNT:
      "Valor da recarga inválido.",
    BELOW_MIN_TOPUP:
      "O valor da recarga está abaixo do mínimo permitido.",
    ABOVE_MAX_TOPUP:
      "O valor da recarga está acima do máximo permitido.",
    TOPUP_DISABLED:
      "As recargas estão desativadas para este evento.",
    WALLET_SETTINGS_NOT_FOUND:
      "Configuração da carteira não encontrada.",
    PARTICIPANT_PHONE_REQUIRED:
      "O participante não possui telefone para realizar o pagamento.",
    TOPUP_CREATION_FAILED:
      "Não foi possível registrar a recarga.",
    INVALID_ITEMS:
      "Itens da venda inválidos.",
    PRODUCT_NOT_FOUND:
      "Produto não encontrado.",
    INSUFFICIENT_BALANCE:
      "Saldo insuficiente.",
    PAYMENT_REFERENCE_REQUIRED:
      "Referência de pagamento obrigatória.",
    PAYMENT_ID_REQUIRED:
      "ID do pagamento obrigatório.",
  };

  return (
    known[message] ||
    message ||
    "Erro interno ao processar a operação."
  );
}

export default async function handler(
  req,
  res
) {
  try {

    const isSessionRequest =
      String(
        req.query?.session || ""
      ).trim() === "1";

    /*
     * LOGIN DO STAFF BAR
     *
     * O login é tratado dentro desta mesma
     * Serverless Function para não criar
     * uma Function adicional no Vercel.
     */
    if (
      isSessionRequest &&
      req.method === "POST"
    ) {

      let body = req.body;

      if (
        typeof body === "string"
      ) {
        try {
          body = JSON.parse(body);
        } catch {
          return sendJson(
            res,
            400,
            {
              success: false,
              error: "INVALID_JSON",
            }
          );
        }
      }

      if (
        !body ||
        typeof body !== "object"
      ) {
        return sendJson(
          res,
          400,
          {
            success: false,
            error: "INVALID_JSON",
          }
        );
      }

      const staffId =
        String(
          body.staff_id || ""
        ).trim();

      const staffPin =
        String(
          body.staff_pin || ""
        ).trim();

      const expectedPin =
        String(
          process.env.BAR_STAFF_PIN || ""
        ).trim();

      if (
        !staffId ||
        staffId.length > 100
      ) {
        return sendJson(
          res,
          400,
          {
            success: false,
            error: "INVALID_STAFF_ID",
          }
        );
      }

      if (
        !staffPin ||
        !expectedPin ||
        !timingSafeEqualString(
          staffPin,
          expectedPin
        )
      ) {
        return sendJson(
          res,
          401,
          {
            success: false,
            error: "INVALID_CREDENTIALS",
          }
        );
      }

      const secret =
        String(
          process.env.BAR_SESSION_SECRET ||
          ""
        ).trim();

      if (!secret) {
        console.error(
          "BAR SESSION: BAR_SESSION_SECRET ausente."
        );

        return sendJson(
          res,
          500,
          {
            success: false,
            error:
              "SERVER_CONFIGURATION_ERROR",
          }
        );
      }

      const now =
        Math.floor(
          Date.now() / 1000
        );

      const sessionMaxAge =
        12 * 60 * 60;

      const payload =
        JSON.stringify({
          staff_id:
            staffId,
          iat:
            now,
          exp:
            now + sessionMaxAge,
        });

      const encodedPayload =
        Buffer
          .from(payload)
          .toString("base64url");

      const signature =
        crypto
          .createHmac(
            "sha256",
            secret
          )
          .update(
            encodedPayload
          )
          .digest("hex");

      const token =
        `${encodedPayload}.${signature}`;

      res.setHeader(
        "Set-Cookie",
        `bar_session=${encodeURIComponent(
          token
        )}; Max-Age=${sessionMaxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`
      );

      return sendJson(
        res,
        200,
        {
          success: true,
          staff_id:
            staffId,
        }
      );
    }

    const session =
      verifyBarSession(req);

    if (!session) {
      return sendJson(
        res,
        401,
        {
          success: false,
          message:
            "Sessão do Staff Bar inválida ou expirada.",
        }
      );
    }

    if (!session) {
      return sendJson(
        res,
        401,
        {
          success: false,
          message:
            "Sessão do Staff Bar inválida ou expirada.",
        }
      );
    }

    if (req.method === "GET") {
  const eventId = String(
    req.query.event_id || ""
  ).trim();

  const shortCode = normalizeShortCode(
    req.query.short_code
  );

  /*
   * Quando o Staff acabou de fazer login,
   * o frontend chama /api/bar-sale sem short_code.
   * Nesse momento precisamos carregar apenas
   * os dados gerais do evento.
   */
  if (!eventId && !shortCode) {
    const defaultEventId =
      "efe5eee5-d361-44b4-a1bf-9d92914fa297";

    const event = await getEvent(
      defaultEventId
    );

    if (!event) {
      return sendJson(res, 404, {
        success: false,
        message: "Evento não encontrado.",
      });
    }

    const [
      products,
      fiscal,
      walletSettings,
    ] = await Promise.all([
      getProducts(defaultEventId),
      getFiscalSettings(defaultEventId),
      getWalletSettings(defaultEventId),
    ]);

    return sendJson(res, 200, {
      success: true,
      event,
      participant: null,
      wallet: null,
      products,
      fiscal,
      wallet_settings: walletSettings,
    });
  }

  if (!eventId || !shortCode) {
    return sendJson(res, 400, {
      success: false,
      message:
        "event_id e short_code são obrigatórios.",
    });
  }

  const event = await getEvent(
    eventId
  );

  if (!event) {
    return sendJson(res, 404, {
      success: false,
      message: "Evento não encontrado.",
    });
  }

  const participant =
    await getParticipant(
      eventId,
      shortCode
    );

  if (!participant) {
    return sendJson(res, 404, {
      success: false,
      message:
        "Participante não encontrado ou inativo.",
    });
  }

  const wallet =
    await getWallet(
      eventId,
      participant.id
    );

  if (!wallet) {
    return sendJson(res, 404, {
      success: false,
      message:
        "Carteira do participante não encontrada.",
    });
  }

  const [
    products,
    fiscal,
    walletSettings,
  ] = await Promise.all([
    getProducts(eventId),
    getFiscalSettings(eventId),
    getWalletSettings(eventId),
  ]);

  return sendJson(res, 200, {
    success: true,
    event,
    participant,
    wallet,
    products,
    fiscal,
    wallet_settings:
      walletSettings,
  });
    }

    if (req.method !== "POST") {
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

    const body =
      req.body &&
      typeof req.body === "object"
        ? req.body
        : {};

    const operation =
      String(
        body.operation || ""
      )
        .trim()
        .toUpperCase();

    const eventId =
      String(
        body.event_id || ""
      ).trim();

    const shortCode =
      normalizeShortCode(
        body.short_code
      );

    if (
      !eventId ||
      !shortCode
    ) {
      return sendJson(
        res,
        400,
        {
          success: false,
          message:
            "event_id e short_code são obrigatórios.",
        }
      );
    }

    if (
      operation ===
      "TEST_PAGAR"
    ) {
      return sendJson(
        res,
        410,
        {
          success: false,
          message:
            "TEST_PAGAR foi desativado. Use TOPUP_PAYMENT para recargas eletrônicas.",
        }
      );
    }

    if (
      operation === "SALE"
    ) {
      const items =
        Array.isArray(body.items)
          ? body.items
          : [];

      if (!items.length) {
        return sendJson(
          res,
          400,
          {
            success: false,
            message:
              "Selecione pelo menos um produto.",
          }
        );
      }

      const normalizedItems =
        items.map((item) => ({
          product_id: String(
            item?.product_id || ""
          ).trim(),
          quantity: Number(
            item?.quantity
          ),
        }));

      const invalidItem =
        normalizedItems.find(
          (item) =>
            !item.product_id ||
            !Number.isInteger(
              item.quantity
            ) ||
            item.quantity <= 0
        );

      if (invalidItem) {
        return sendJson(
          res,
          400,
          {
            success: false,
            message:
              "Produto ou quantidade inválida.",
          }
        );
      }

      const result =
        await processSale({
          eventId,
          shortCode,
          items: normalizedItems,
          staffId:
            session.staff_id,
        });

      return sendJson(
        res,
        200,
        {
          success: true,
          operation:
            "SALE",
          ...(result &&
          typeof result === "object"
            ? result
            : {}),
        }
      );
    }

    if (
      operation === "TOPUP" ||
      operation ===
        "TOPUP_PAYMENT"
    ) {
      const amount =
        normalizeAmount(
          body.amount
        );

      const paymentMethod =
        normalizePaymentMethod(
          body.payment_method ||
            body.method
        );

      if (!amount) {
        return sendJson(
          res,
          400,
          {
            success: false,
            message:
              "Valor da recarga inválido.",
          }
        );
      }

      const event =
        await getEvent(
          eventId
        );

      if (!event) {
        return sendJson(
          res,
          404,
          {
            success: false,
            message:
              "Evento não encontrado.",
          }
        );
      }

      const participant =
        await getParticipant(
          eventId,
          shortCode
        );

      if (!participant) {
        return sendJson(
          res,
          404,
          {
            success: false,
            message:
              "Participante não encontrado ou inativo.",
          }
        );
      }

      const wallet =
        await getWallet(
          eventId,
          participant.id
        );

      if (!wallet) {
        return sendJson(
          res,
          404,
          {
            success: false,
            message:
              "Carteira do participante não encontrada.",
          }
        );
      }

      const walletSettings =
        await getWalletSettings(
          eventId
        );

      validateTopupSettings(
        amount,
        walletSettings
      );

      if (
        paymentMethod ===
        "CASH"
      ) {
        if (
          operation !==
          "TOPUP"
        ) {
          return sendJson(
            res,
            400,
            {
              success: false,
              message:
                "TOPUP_PAYMENT é destinado a pagamentos eletrônicos.",
            }
          );
        }

        const result =
          await processCashTopup({
            eventId,
            shortCode,
            amount,
            staffId:
              session.staff_id,
            description:
              body.description ||
              "Recarga CASH — Staff Bar",
          });

        return sendJson(
  res,
  200,
  {
    success: true,
    operation: "TOPUP",
    payment_method: "CASH",
    status: "PAID",
    ...(result && typeof result === "object"
      ? result
      : {}),
  }
);
      }

      if (
        paymentMethod !==
          "EMOLA" &&
        paymentMethod !==
          "MPESA"
      ) {
        return sendJson(
          res,
          400,
          {
            success: false,
            message:
              "Método de pagamento inválido. Use CASH, EMOLA ou MPESA.",
          }
        );
      }

      if (
        operation !==
        "TOPUP_PAYMENT"
      ) {
        return sendJson(
          res,
          400,
          {
            success: false,
            message:
              "Para eMOLA/M-Pesa use a operação TOPUP_PAYMENT.",
          }
        );
      }

      const result =
        await processElectronicTopup({
          eventId,
          participant,
          wallet,
          amount,
          paymentMethod,
          staffId:
            session.staff_id,
          phone:
            body.phone,
          description:
            body.description ||
            `Recarga ${paymentMethod} — Staff Bar`,
        });

      return sendJson(
        res,
        200,
        result
      );
    }

    return sendJson(
      res,
      400,
      {
        success: false,
        message:
          "Operação inválida. Use SALE, TOPUP ou TOPUP_PAYMENT.",
      }
    );
  } catch (error) {
    console.error(
      "bar-sale error:",
      error
    );

    const message =
      mapErrorMessage(
        error
      );

    const status =
      error?.status &&
      Number.isInteger(
        Number(error.status)
      )
        ? Number(
            error.status
          )
        : 500;

    return sendJson(
      res,
      status,
      {
        success: false,
        message,
      }
    );
  }
}
