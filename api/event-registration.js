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
