import crypto from "node:crypto";

const SUPABASE_URL =
  String(process.env.SUPABASE_URL || "").trim();

const SUPABASE_SERVICE_ROLE_KEY =
  String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

function sendJson(res, status, data) {
  res.status(status).json(data);
}

async function supabaseRequest(path, options) {
  const requestOptions = options || {};

  const response = await fetch(
    SUPABASE_URL + "/rest/v1/" + path,
    {
      ...requestOptions,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        ...(requestOptions.headers || {})
      }
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

  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");

  if (digits.startsWith("258")) {
    digits = digits.slice(3);
  }

  return digits;
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

function generateShortCode() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code = "";

  for (let i = 0; i < 6; i++) {
    const index =
      crypto.randomInt(0, alphabet.length);

    code += alphabet[index];
  }

  return code;
}

async function getEvent(eventId) {
  return supabaseRequest(
    "events?id=eq." +
      encodeURIComponent(eventId) +
      "&select=id,status&limit=1",
    {
      method: "GET"
    }
  );
}

async function findParticipantByPhone(
  eventId,
  normalizedPhone
) {
  const result = await supabaseRequest(
    "event_participants?event_id=eq." +
      encodeURIComponent(eventId) +
      "&status=eq.ACTIVE&phone=eq." +
      encodeURIComponent(normalizedPhone) +
      "&select=id,event_id,full_name,phone,short_code,status&limit=2",
    {
      method: "GET"
    }
  );

  if (!result.ok || !Array.isArray(result.data)) {
    return {
      error: true,
      result
    };
  }

  return {
    error: false,
    participant: result.data[0] || null
  };
}

async function shortCodeExists(shortCode) {
  const result = await supabaseRequest(
    "event_participants?short_code=eq." +
      encodeURIComponent(shortCode) +
      "&select=id&limit=1",
    {
      method: "GET"
    }
  );

  if (!result.ok) {
    return {
      error: true,
      result
    };
  }

  return {
    error: false,
    exists:
      Array.isArray(result.data) &&
      result.data.length > 0
  };
}

async function createParticipant({
  eventId,
  fullName,
  phone,
  shortCode
}) {
  return supabaseRequest(
    "event_participants",
    {
      method: "POST",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        event_id: eventId,
        full_name: fullName,
        phone: phone,
        short_code: shortCode,
        status: "ACTIVE"
      })
    }
  );
}

async function createWallet({
  eventId,
  participantId
}) {
  return supabaseRequest(
    "wallet_accounts",
    {
      method: "POST",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        event_id: eventId,
        participant_id: participantId,
        balance: 0,
        status: "ACTIVE"
      })
    }
  );
}

async function handleClientRegister(body, res) {
  const eventId = String(
    body.event_id || body.eventId || ""
  ).trim();

  const fullName = String(
    body.full_name || body.fullName || ""
  ).trim();

  const rawPhone = String(
    body.phone || body.contact || ""
  ).trim();

  if (!isUuid(eventId)) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_EVENT_ID"
    });
  }

  if (!fullName || fullName.length < 3 || fullName.length > 150) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_FULL_NAME"
    });
  }

  const phone = normalizePhone(rawPhone);

  if (
    !phone ||
    phone.length < 9 ||
    phone.length > 15
  ) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_PHONE"
    });
  }

  const eventResult = await getEvent(eventId);

  if (!eventResult.ok) {
    console.error(
      "CLIENT REGISTER: erro ao consultar evento. HTTP " +
        eventResult.status
    );

    return sendJson(res, 500, {
      success: false,
      error: "EVENT_LOOKUP_FAILED"
    });
  }

  if (
    !Array.isArray(eventResult.data) ||
    eventResult.data.length === 0
  ) {
    return sendJson(res, 404, {
      success: false,
      error: "EVENT_NOT_FOUND"
    });
  }

  const participantResult =
    await findParticipantByPhone(
      eventId,
      phone
    );

  if (participantResult.error) {
    console.error(
      "CLIENT REGISTER: erro ao procurar participante."
    );

    return sendJson(res, 500, {
      success: false,
      error: "PARTICIPANT_LOOKUP_FAILED"
    });
  }

  if (participantResult.participant) {
    const participant =
      participantResult.participant;

    return sendJson(res, 200, {
      success: true,
      existing: true,
      message:
        "Este contacto já está registado neste evento.",
      participant: {
        id: participant.id,
        full_name: participant.full_name,
        phone: participant.phone,
        short_code: participant.short_code
      }
    });
  }

  let participant = null;

  for (let attempt = 0; attempt < 10; attempt++) {
    const shortCode = generateShortCode();

    const existsResult =
      await shortCodeExists(shortCode);

    if (existsResult.error) {
      console.error(
        "CLIENT REGISTER: erro ao verificar Short Code."
      );

      return sendJson(res, 500, {
        success: false,
        error: "SHORT_CODE_CHECK_FAILED"
      });
    }

    if (existsResult.exists) {
      continue;
    }

    const createResult =
      await createParticipant({
        eventId,
        fullName,
        phone,
        shortCode
      });

    if (createResult.ok) {
      participant =
        Array.isArray(createResult.data)
          ? createResult.data[0]
          : createResult.data;

      break;
    }

    if (
      createResult.status === 409 ||
      createResult.status === 23505
    ) {
      continue;
    }

    console.error(
      "CLIENT REGISTER: erro ao criar participante. HTTP " +
        createResult.status
    );

    return sendJson(res, 500, {
      success: false,
      error: "PARTICIPANT_CREATE_FAILED"
    });
  }

  if (!participant) {
    return sendJson(res, 500, {
      success: false,
      error: "SHORT_CODE_GENERATION_FAILED"
    });
  }

  const walletResult =
    await createWallet({
      eventId,
      participantId: participant.id
    });

  if (!walletResult.ok) {
    console.error(
      "CLIENT REGISTER: erro ao criar carteira. HTTP " +
        walletResult.status
    );

    await supabaseRequest(
      "event_participants?id=eq." +
        encodeURIComponent(participant.id),
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "INACTIVE"
        })
      }
    );

    return sendJson(res, 500, {
      success: false,
      error: "WALLET_CREATE_FAILED"
    });
  }

  const wallet =
    Array.isArray(walletResult.data)
      ? walletResult.data[0]
      : walletResult.data;

  return sendJson(res, 201, {
    success: true,
    existing: false,
    message:
      "REGISTO CONCLUÍDO. Guarde o seu Short Code.",
    participant: {
      id: participant.id,
      full_name: participant.full_name,
      phone: participant.phone,
      short_code: participant.short_code
    },
    wallet: {
      id: wallet && wallet.id
        ? wallet.id
        : null,
      balance: 0
    }
  });
}

async function findParticipantsByName(
  eventId,
  normalizedName
) {
  const result = await supabaseRequest(
    "event_participants?event_id=eq." +
      encodeURIComponent(eventId) +
      "&status=eq.ACTIVE&full_name=ilike." +
      encodeURIComponent(normalizedName) +
      "&select=id,event_id,full_name,phone,short_code,status&limit=2",
    {
      method: "GET"
    }
  );

  if (!result.ok || !Array.isArray(result.data)) {
    return {
      error: true,
      result
    };
  }

  return {
    error: false,
    participants: result.data
  };
}

async function handleClientIdentify(body, res) {
  const eventId = String(
    body.event_id || body.eventId || ""
  ).trim();

  const fullName = String(
    body.full_name || body.fullName || body.name || ""
  ).trim();

  const rawPhone = String(
    body.phone || body.contact || ""
  ).trim();

  const normalizedName =
    normalizeName(fullName);

  const normalizedPhone =
    normalizePhone(rawPhone);

  if (!isUuid(eventId)) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_EVENT_ID"
    });
  }

  if (!normalizedName && !normalizedPhone) {
    return sendJson(res, 400, {
      success: false,
      error: "IDENTIFICATION_DATA_REQUIRED"
    });
  }

  if (
    normalizedName &&
    (normalizedName.length < 3 ||
      normalizedName.length > 150)
  ) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_FULL_NAME"
    });
  }

  if (
    normalizedPhone &&
    (normalizedPhone.length < 9 ||
      normalizedPhone.length > 15)
  ) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_PHONE"
    });
  }

  const eventResult = await getEvent(eventId);

  if (!eventResult.ok) {
    console.error(
      "CLIENT IDENTIFY: erro ao consultar evento. HTTP " +
        eventResult.status
    );

    return sendJson(res, 500, {
      success: false,
      error: "EVENT_LOOKUP_FAILED"
    });
  }

  if (
    !Array.isArray(eventResult.data) ||
    eventResult.data.length === 0
  ) {
    return sendJson(res, 404, {
      success: false,
      error: "EVENT_NOT_FOUND"
    });
  }

  /*
   * CONTACTO TEM PRIORIDADE.
   *
   * A pesquisa é feita diretamente no Supabase.
   * Não carregamos todos os participantes.
   */
  if (normalizedPhone) {
    const phoneResult =
      await findParticipantByPhone(
        eventId,
        normalizedPhone
      );

    if (phoneResult.error) {
      console.error(
        "CLIENT IDENTIFY: erro ao procurar participante pelo contacto."
      );

      return sendJson(res, 500, {
        success: false,
        error: "PARTICIPANT_LOOKUP_FAILED"
      });
    }

    if (phoneResult.participant) {
      const participant =
        phoneResult.participant;

      return sendJson(res, 200, {
        success: true,
        found: true,
        matched_by: "phone",
        participant: {
          full_name: participant.full_name,
          phone: participant.phone,
          short_code: participant.short_code
        }
      });
    }
  }

  /*
   * Se não encontrou pelo contacto, tenta pelo nome.
   *
   * O nome precisa ser único para revelar o Short Code.
   */
  if (normalizedName) {
    const nameResult =
      await findParticipantsByName(
        eventId,
        normalizedName
      );

    if (nameResult.error) {
      console.error(
        "CLIENT IDENTIFY: erro ao procurar participante pelo nome."
      );

      return sendJson(res, 500, {
        success: false,
        error: "PARTICIPANT_LOOKUP_FAILED"
      });
    }

    const nameMatches =
      nameResult.participants;

    if (nameMatches.length === 1) {
      const participant =
        nameMatches[0];

      return sendJson(res, 200, {
        success: true,
        found: true,
        matched_by: "name",
        participant: {
          full_name: participant.full_name,
          phone: participant.phone,
          short_code: participant.short_code
        }
      });
    }

    if (nameMatches.length > 1) {
      return sendJson(res, 409, {
        success: false,
        found: false,
        error: "MULTIPLE_NAME_MATCHES",
        message:
          "Encontrámos mais de uma pessoa com esse nome. Informe o contacto correto para identificar o seu registo."
      });
    }
  }

  return sendJson(res, 404, {
    success: false,
    found: false,
    error: "PARTICIPANT_NOT_FOUND",
    message:
      "Não encontrámos um registo com os dados informados."
  });
}


function generateTopupReference(eventId) {
  const eventPart = String(eventId)
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 12);

  const randomPart = crypto
    .randomBytes(8)
    .toString("hex");

  return [
    "BAR-TOPUP",
    eventPart,
    "CLIENT",
    Date.now(),
    randomPart,
  ].join("-");
}

function generateIdempotencyKey(reference) {
  return `bar-topup-${reference}`;
}

function getPagarConfig() {
  const baseUrl =
    String(process.env.PAGAR_API_BASE_URL || "").trim();

  const apiKey =
    String(process.env.PAGAR_API_KEY || "").trim();

  const signingSecret =
    String(process.env.PAGAR_SIGNING_SECRET || "").trim();

  if (!baseUrl || !apiKey || !signingSecret) {
    throw new Error("PAGAR_CONFIGURATION_MISSING");
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    signingSecret,
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

async function getClientParticipant(eventId, shortCode) {
  const result = await supabaseRequest(
    "event_participants?event_id=eq." +
      encodeURIComponent(eventId) +
      "&short_code=eq." +
      encodeURIComponent(shortCode) +
      "&status=eq.ACTIVE" +
      "&select=id,event_id,full_name,phone,short_code,status" +
      "&limit=1",
    {
      method: "GET"
    }
  );

  if (!result.ok || !Array.isArray(result.data)) {
    return {
      error: true,
      result
    };
  }

  return {
    error: false,
    participant: result.data[0] || null
  };
}

async function getClientWallet(eventId, participantId) {
  const result = await supabaseRequest(
    "wallet_accounts?event_id=eq." +
      encodeURIComponent(eventId) +
      "&participant_id=eq." +
      encodeURIComponent(participantId) +
      "&status=eq.ACTIVE" +
      "&select=id,event_id,participant_id,balance,status" +
      "&limit=1",
    {
      method: "GET"
    }
  );

  if (!result.ok || !Array.isArray(result.data)) {
    return {
      error: true,
      result
    };
  }

  return {
    error: false,
    wallet: result.data[0] || null
  };
}

async function getClientWalletSettings(eventId) {
  const result = await supabaseRequest(
    "wallet_settings?event_id=eq." +
      encodeURIComponent(eventId) +
      "&select=id,event_id,min_topup,max_topup,currency,topup_enabled,topup_min_amount,topup_max_amount" +
      "&limit=1",
    {
      method: "GET"
    }
  );

  if (!result.ok || !Array.isArray(result.data)) {
    return {
      error: true,
      result
    };
  }

  return {
    error: false,
    settings: result.data[0] || null
  };
}

function validateClientTopupAmount(amount, settings) {
  if (!settings) {
    throw new Error("WALLET_SETTINGS_NOT_FOUND");
  }

  if (settings.topup_enabled === false) {
    throw new Error("TOPUP_DISABLED");
  }

  if (!Number.isFinite(amount) || amount < 50) {
    throw new Error("BELOW_MIN_TOPUP");
  }
}

async function createClientPendingTopup({
  eventId,
  participantId,
  walletId,
  amount,
  reference,
  paymentMethod,
  description
}) {
  const result = await supabaseRequest(
    "wallet_topups",
    {
      method: "POST",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        event_id: eventId,
        wallet_id: walletId,
        participant_id: participantId,
        amount,
        payment_status: "PENDING",
        payment_reference: reference,
        payment_id: null,
        payment_method: paymentMethod,
        staff_id: null,
        description:
          description || "Recarga pelo site do cliente"
      })
    }
  );

  if (
    !result.ok ||
    !Array.isArray(result.data) ||
    !result.data[0]
  ) {
    throw new Error("TOPUP_CREATION_FAILED");
  }

  return result.data[0];
}

async function updateClientPendingTopupPayment(
  reference,
  paymentId
) {
  return supabaseRequest(
    "wallet_topups?payment_reference=eq." +
      encodeURIComponent(reference) +
      "&payment_status=eq.PENDING",
    {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        payment_id: paymentId || null
      })
    }
  );
}

async function markClientTopupFailed(
  reference,
  description
) {
  return supabaseRequest(
    "wallet_topups?payment_reference=eq." +
      encodeURIComponent(reference) +
      "&payment_status=eq.PENDING",
    {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        payment_status: "FAILED",
        description: description || null
      })
    }
  );
}

async function handleClientBalance(body, res) {
  const eventId = String(
    body.event_id || body.eventId || ""
  ).trim();

  const shortCode = String(
    body.short_code || body.shortCode || ""
  ).trim().toUpperCase();

  if (!isUuid(eventId)) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_EVENT_ID"
    });
  }

  if (!shortCode || shortCode.length > 20) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_SHORT_CODE"
    });
  }

  const eventResult = await getEvent(eventId);

  if (
    !eventResult.ok ||
    !Array.isArray(eventResult.data) ||
    eventResult.data.length === 0
  ) {
    return sendJson(res, 404, {
      success: false,
      error: "EVENT_NOT_FOUND"
    });
  }

  const participantResult =
    await getClientParticipant(
      eventId,
      shortCode
    );

  if (participantResult.error) {
    return sendJson(res, 500, {
      success: false,
      error: "PARTICIPANT_LOOKUP_FAILED"
    });
  }

  if (!participantResult.participant) {
    return sendJson(res, 404, {
      success: false,
      error: "PARTICIPANT_NOT_FOUND",
      message:
        "Short Code não encontrado ou inativo."
    });
  }

  const walletResult =
    await getClientWallet(
      eventId,
      participantResult.participant.id
    );

  if (walletResult.error) {
    return sendJson(res, 500, {
      success: false,
      error: "WALLET_LOOKUP_FAILED"
    });
  }

  if (!walletResult.wallet) {
    return sendJson(res, 404, {
      success: false,
      error: "WALLET_NOT_FOUND"
    });
  }

  return sendJson(res, 200, {
    success: true,
    operation: "CLIENT_BALANCE",
    participant: {
      full_name:
        participantResult.participant.full_name,
      short_code:
        participantResult.participant.short_code
    },
    wallet: {
      balance:
        Number(walletResult.wallet.balance || 0),
      currency: "MZN",
      status:
        walletResult.wallet.status
    }
  });
}

async function handleClientTopup(body, res) {
  const eventId = String(
    body.event_id || body.eventId || ""
  ).trim();

  const shortCode = String(
    body.short_code || body.shortCode || ""
  ).trim().toUpperCase();

  const paymentMethod = String(
    body.payment_method ||
      body.paymentMethod ||
      ""
  ).trim().toUpperCase();

  const amount = Number(body.amount);

  if (!isUuid(eventId)) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_EVENT_ID"
    });
  }

  if (!shortCode || shortCode.length > 20) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_SHORT_CODE"
    });
  }

  if (
    !["EMOLA", "MPESA", "CASH"].includes(
      paymentMethod
    )
  ) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_PAYMENT_METHOD"
    });
  }

  const eventResult = await getEvent(eventId);

  if (
    !eventResult.ok ||
    !Array.isArray(eventResult.data) ||
    eventResult.data.length === 0
  ) {
    return sendJson(res, 404, {
      success: false,
      error: "EVENT_NOT_FOUND"
    });
  }

  if (
    String(eventResult.data[0].status || "").toUpperCase() !==
    "OPEN"
  ) {
    return sendJson(res, 409, {
      success: false,
      error: "EVENT_CLOSED",
      message:
        "O evento não está aberto para recargas."
    });
  }

  const participantResult =
    await getClientParticipant(
      eventId,
      shortCode
    );

  if (participantResult.error) {
    return sendJson(res, 500, {
      success: false,
      error: "PARTICIPANT_LOOKUP_FAILED"
    });
  }

  const participant =
    participantResult.participant;

  if (!participant) {
    return sendJson(res, 404, {
      success: false,
      error: "PARTICIPANT_NOT_FOUND",
      message:
        "Short Code não encontrado ou inativo."
    });
  }

  const walletResult =
    await getClientWallet(
      eventId,
      participant.id
    );

  if (walletResult.error) {
    return sendJson(res, 500, {
      success: false,
      error: "WALLET_LOOKUP_FAILED"
    });
  }

  const wallet = walletResult.wallet;

  if (!wallet) {
    return sendJson(res, 404, {
      success: false,
      error: "WALLET_NOT_FOUND"
    });
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_AMOUNT",
      message: "Digite um valor de recarga válido."
    });
  }

  if (paymentMethod === "CASH") {
    return sendJson(res, 200, {
      success: true,
      operation: "CLIENT_TOPUP",
      payment_method: "CASH",
      status: "STAFF_REQUIRED",
      amount,
      participant: {
        full_name: participant.full_name,
        short_code: participant.short_code
      },
      message:
        "Para recarga em CASH, dirija-se ao Staff Bar. O saldo será atualizado após a confirmação do pagamento."
    });
  }

  const settingsResult =
    await getClientWalletSettings(eventId);

  if (settingsResult.error) {
    return sendJson(res, 500, {
      success: false,
      error: "WALLET_SETTINGS_LOOKUP_FAILED"
    });
  }

  try {
    validateClientTopupAmount(
      amount,
      settingsResult.settings
    );
  } catch (error) {
    const messages = {
      INVALID_AMOUNT:
        "Digite um valor de recarga válido.",
      BELOW_MIN_TOPUP:
        "O valor da recarga está abaixo do mínimo permitido.",
      TOPUP_DISABLED:
        "As recargas estão desativadas para este evento.",
      WALLET_SETTINGS_NOT_FOUND:
        "Configuração da carteira não encontrada."
    };

    return sendJson(res, 400, {
      success: false,
      error: error.message,
      message:
        messages[error.message] ||
        "Não foi possível validar a recarga."
    });
  }

  const payerPhone =
    normalizePhone(participant.phone);

  if (!payerPhone) {
    return sendJson(res, 400, {
      success: false,
      error: "PARTICIPANT_PHONE_REQUIRED",
      message:
        "O participante não possui contacto válido para realizar o pagamento."
    });
  }

  const reference =
    generateTopupReference(eventId);

  const description =
    `BLACK OUT — Recarga ${paymentMethod} | ${participant.full_name} | ${reference}`;

  await createClientPendingTopup({
    eventId,
    participantId: participant.id,
    walletId: wallet.id,
    amount,
    reference,
    paymentMethod,
    description
  });

  try {
    const payment = await pagarPost(
      "/payments",
      {
        amountMzn: amount,
        method: paymentMethod,
        payerPhone,
        title:
          "BLACK OUT — RECARGA DE CARTEIRA",
        description,
        reference
      },
      generateIdempotencyKey(reference)
    );

    const paymentId =
      extractPaymentId(payment);

    const paymentStatus =
      extractPaymentStatus(payment);

    if (!paymentId) {
      throw new Error("PAGAR_PAYMENT_ID_MISSING");
    }

    const updateResult =
      await updateClientPendingTopupPayment(
        reference,
        paymentId
      );

    if (!updateResult.ok) {
      console.error(
        "CLIENT TOPUP: pagamento Pagar criado, mas falhou a atualização do payment_id.",
        {
          reference,
          paymentId
        }
      );

      return sendJson(res, 502, {
        success: false,
        error: "TOPUP_PAYMENT_SYNC_FAILED",
        message:
          "O pagamento foi iniciado, mas não foi possível sincronizar a recarga. Não repita o pagamento; contacte o suporte."
      });
    }

    return sendJson(res, 200, {
      success: true,
      operation: "CLIENT_TOPUP",
      status: "PENDING",
      payment_status:
        paymentStatus || "PENDING",
      payment_reference: reference,
      payment_id: paymentId,
      payment_method: paymentMethod,
      amount,
      participant: {
        full_name: participant.full_name,
        short_code: participant.short_code
      },
      message:
        "Pagamento criado. O saldo será creditado somente após a confirmação do pagamento."
    });
  } catch (error) {
    try {
      await markClientTopupFailed(
        reference,
        `Falha ao criar pagamento Pagar: ${error.message}`
      );
    } catch (markError) {
      console.error(
        "CLIENT TOPUP: falha ao marcar pagamento como FAILED.",
        markError
      );
    }

    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return sendJson(res, 405, {
      success: false,
      error: "METHOD_NOT_ALLOWED"
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "EVENT REGISTRATION: configuração do Supabase ausente."
    );

    return sendJson(res, 500, {
      success: false,
      error: "SERVER_CONFIGURATION_ERROR"
    });
  }

  let body = req.body;

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return sendJson(res, 400, {
        success: false,
        error: "INVALID_JSON"
      });
    }
  }

  if (!body || typeof body !== "object") {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_JSON"
    });
  }

  const operation =
    String(body.operation || "").trim().toUpperCase();


  if (operation === "CLIENT_BALANCE") {
    try {
      return await handleClientBalance(
        body,
        res
      );
    } catch (error) {
      console.error(
        "CLIENT BALANCE: erro inesperado.",
        error
      );

      return sendJson(res, 500, {
        success: false,
        error: "CLIENT_BALANCE_FAILED"
      });
    }
  }

  if (operation === "CLIENT_TOPUP") {
    try {
      return await handleClientTopup(
        body,
        res
      );
    } catch (error) {
      console.error(
        "CLIENT TOPUP: erro inesperado.",
        error
      );

      const known = {
        PAGAR_CONFIGURATION_MISSING:
          "Configuração do pagamento indisponível.",
        PAGAR_PAYMENT_ID_MISSING:
          "O serviço de pagamento não devolveu uma referência válida.",
        TOPUP_CREATION_FAILED:
          "Não foi possível registrar a recarga.",
        PARTICIPANT_PHONE_REQUIRED:
          "O participante não possui contacto válido para realizar o pagamento."
      };

      const safeError =
        known[error?.message]
          ? error.message
          : "CLIENT_TOPUP_FAILED";

      return sendJson(res, 500, {
        success: false,
        error: safeError,
        message:
          known[error?.message] ||
          "Não foi possível iniciar a recarga."
      });
    }
  }

  if (operation === "CLIENT_REGISTER") {
    try {
      return await handleClientRegister(
        body,
        res
      );
    } catch (error) {
      console.error(
        "CLIENT REGISTER: erro inesperado.",
        error
      );

      return sendJson(res, 500, {
        success: false,
        error: "CLIENT_REGISTER_FAILED"
      });
    }
  }

  if (operation === "CLIENT_IDENTIFY") {
    try {
      return await handleClientIdentify(
        body,
        res
      );
    } catch (error) {
      console.error(
        "CLIENT IDENTIFY: erro inesperado.",
        error
      );

      return sendJson(res, 500, {
        success: false,
        error: "CLIENT_IDENTIFY_FAILED"
      });
    }
  }

  /*
   * FLUXO EXISTENTE DE REGISTO DE EVENTOS
   * Preservado para o Behind the Sunset.
   */

  const eventSlug =
    String(body.eventSlug || "").trim();

  const eventName =
    String(body.eventName || "").trim();

  const fullName =
    String(body.fullName || "").trim();

  const phone =
    String(body.phone || "").trim();

  const email =
    String(body.email || "").trim();

  if (!eventSlug || eventSlug.length > 100) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_EVENT"
    });
  }

  if (!eventName || eventName.length > 200) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_EVENT_NAME"
    });
  }

  if (!fullName || fullName.length > 200) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_FULL_NAME"
    });
  }

  if (!phone || phone.length > 50) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_PHONE"
    });
  }

  if (email && email.length > 254) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_EMAIL"
    });
  }

  try {
    const result = await supabaseRequest(
      "event_registrations",
      {
        method: "POST",
        headers: {
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          event_slug: eventSlug,
          event_name: eventName,
          full_name: fullName,
          phone: phone,
          email: email
        })
      }
    );

    if (!result.ok) {
      console.error(
        "EVENT REGISTRATION: Supabase recusou o registo. HTTP " +
          result.status
      );

      return sendJson(res, 500, {
        success: false,
        error: "REGISTRATION_FAILED"
      });
    }

    const registration =
      Array.isArray(result.data)
        ? result.data[0]
        : result.data;

    return sendJson(res, 200, {
      success: true,
      registration: registration
    });

  } catch (error) {
    console.error(
      "EVENT REGISTRATION: erro inesperado.",
      error
    );

    return sendJson(res, 500, {
      success: false,
      error: "REGISTRATION_FAILED"
    });
  }
}
