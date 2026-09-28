import crypto from "node:crypto";

const SUPABASE_URL =
  String(process.env.SUPABASE_URL || "").trim();

const SUPABASE_SERVICE_ROLE_KEY =
  String(
    process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  ).trim();

function sendJson(res, status, data) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify(data));
}

async function supabaseRequest(path, options = {}) {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "SUPABASE_CONFIGURATION_ERROR"
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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
      data?.details ||
      "SUPABASE_REQUEST_FAILED"
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

/*
 * Mantém apenas os dígitos.
 *
 * Exemplos:
 * 84 123 4567
 * +258 84 123 4567
 * 841234567
 *
 * passam a ser comparados de forma consistente.
 */
function normalizePhone(value) {
  let phone = String(value || "")
    .trim()
    .replace(/\D/g, "");

  if (phone.startsWith("258")) {
    phone = phone.slice(3);
  }

  return phone;
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

/*
 * Short Code:
 *
 * Exemplo:
 * PG7K4M
 *
 * O código não depende do nome,
 * telefone ou outros dados pessoais.
 */
function generateShortCode() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  const bytes = crypto.randomBytes(6);

  let code = "";

  for (let i = 0; i < 6; i += 1) {
    code += alphabet[
      bytes[i] % alphabet.length
    ];
  }

  return code;
}

async function getEvent(eventId) {
  const rows =
    await supabaseRequest(
      `events?id=eq.${encodeURIComponent(
        eventId
      )}&select=id,status&limit=1`
    );

  if (!Array.isArray(rows)) {
    return null;
  }

  return rows[0] || null;
}

async function findParticipantByPhone(
  eventId,
  phone
) {
  const rows =
    await supabaseRequest(
      `event_participants?event_id=eq.${encodeURIComponent(
        eventId
      )}&status=eq.ACTIVE&select=id,event_id,full_name,phone,short_code,status,created_at`
    );

  if (!Array.isArray(rows)) {
    return null;
  }

  return (
    rows.find(
      (participant) =>
        normalizePhone(
          participant.phone
        ) === phone
    ) || null
  );
}

async function shortCodeExists(
  eventId,
  shortCode
) {
  const rows =
    await supabaseRequest(
      `event_participants?event_id=eq.${encodeURIComponent(
        eventId
      )}&short_code=eq.${encodeURIComponent(
        shortCode
      )}&select=id&limit=1`
    );

  return (
    Array.isArray(rows) &&
    rows.length > 0
  );
}

async function createParticipant({
  eventId,
  fullName,
  phone,
}) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const shortCode =
      generateShortCode();

    if (
      await shortCodeExists(
        eventId,
        shortCode
      )
    ) {
      continue;
    }

    const rows =
      await supabaseRequest(
        "event_participants",
        {
          method: "POST",
          headers: {
            Prefer:
              "return=representation",
          },
          body: JSON.stringify({
            event_id: eventId,
            full_name: fullName,
            phone,
            short_code: shortCode,
            status: "ACTIVE",
          }),
        }
      );

    if (
      !Array.isArray(rows) ||
      !rows[0]
    ) {
      throw new Error(
        "PARTICIPANT_CREATION_FAILED"
      );
    }

    return rows[0];
  }

  throw new Error(
    "SHORT_CODE_GENERATION_FAILED"
  );
}

async function createWallet({
  eventId,
  participantId,
}) {
  const rows =
    await supabaseRequest(
      "wallet_accounts",
      {
        method: "POST",
        headers: {
          Prefer:
            "return=representation",
        },
        body: JSON.stringify({
          event_id: eventId,
          participant_id:
            participantId,
          balance: 0,
          status: "ACTIVE",
        }),
      }
    );

  if (
    !Array.isArray(rows) ||
    !rows[0]
  ) {
    throw new Error(
      "WALLET_CREATION_FAILED"
    );
  }

  return rows[0];
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return sendJson(res, 405, {
      success: false,
      error: "METHOD_NOT_ALLOWED",
    });
  }

  try {
    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY
    ) {
      return sendJson(res, 500, {
        success: false,
        error:
          "SERVER_CONFIGURATION_ERROR",
      });
    }

    const body =
      req.body &&
      typeof req.body === "object"
        ? req.body
        : {};

    const eventId =
      String(
        body.event_id ||
        body.eventId ||
        ""
      ).trim();

    const fullName =
      normalizeName(
        body.full_name ||
        body.fullName ||
        ""
      );

    const phone =
      normalizePhone(
        body.phone ||
        body.contact ||
        ""
      );

    if (!isUuid(eventId)) {
      return sendJson(res, 400, {
        success: false,
        error: "INVALID_EVENT_ID",
      });
    }

    if (
      fullName.length < 3 ||
      fullName.length > 150
    ) {
      return sendJson(res, 400, {
        success: false,
        error: "INVALID_FULL_NAME",
        message:
          "Informe o nome completo.",
      });
    }

    if (
      phone.length < 9 ||
      phone.length > 15
    ) {
      return sendJson(res, 400, {
        success: false,
        error: "INVALID_PHONE",
        message:
          "Informe um contacto válido.",
      });
    }

    /*
     * Confirmamos que o evento existe.
     */
    const event =
      await getEvent(eventId);

    if (!event) {
      return sendJson(res, 404, {
        success: false,
        error: "EVENT_NOT_FOUND",
      });
    }

    /*
     * Procuramos o mesmo contacto
     * dentro do mesmo evento.
     *
     * Não criamos outro participante
     * para o mesmo cliente.
     */
    const existing =
      await findParticipantByPhone(
        eventId,
        phone
      );

    if (existing) {
      return sendJson(res, 200, {
        success: true,
        existing: true,
        participant: {
          id: existing.id,
          event_id:
            existing.event_id,
          full_name:
            existing.full_name,
          short_code:
            existing.short_code,
          status:
            existing.status,
        },
        message:
          "Este contacto já possui um registo neste evento.",
      });
    }

    /*
     * Criar participante.
     */
    const participant =
      await createParticipant({
        eventId,
        fullName,
        phone,
      });

    /*
     * Criar carteira com saldo inicial 0.
     */
    let wallet;

    try {
      wallet =
        await createWallet({
          eventId,
          participantId:
            participant.id,
        });
    } catch (walletError) {
      /*
       * Não deixamos um participante
       * sem carteira.
       *
       * Tentamos marcar o participante
       * como INACTIVE caso a carteira
       * não possa ser criada.
       */
      try {
        await supabaseRequest(
          `event_participants?id=eq.${encodeURIComponent(
            participant.id
          )}`,
          {
            method: "PATCH",
            headers: {
              Prefer:
                "return=minimal",
            },
            body: JSON.stringify({
              status: "INACTIVE",
            }),
          }
        );
      } catch {}

      throw walletError;
    }

    return sendJson(res, 201, {
      success: true,
      existing: false,
      participant: {
        id: participant.id,
        event_id:
          participant.event_id,
        full_name:
          participant.full_name,
        short_code:
          participant.short_code,
        status:
          participant.status,
      },
      wallet: {
        id: wallet.id,
        event_id:
          wallet.event_id,
        participant_id:
          wallet.participant_id,
        balance:
          Number(wallet.balance || 0),
        status:
          wallet.status,
      },
      message:
        "Registo concluído com sucesso.",
    });
  } catch (error) {
    console.error(
      "CLIENT REGISTER ERROR:",
      error?.message ||
        "UNKNOWN_ERROR"
    );

    return sendJson(res, 500, {
      success: false,
      error:
        "REGISTRATION_FAILED",
      message:
        "Não foi possível concluir o registo.",
    });
  }
}