import crypto from "node:crypto";

function getSecret() {
  return String(process.env.CHECKIN_SECRET || "").trim();
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));

  if (aa.length !== bb.length) {
    return false;
  }

  return crypto.timingSafeEqual(aa, bb);
}

function getCookie(req, name) {
  const header = req.headers && req.headers.cookie;

  if (!header) {
    return "";
  }

  for (const item of header.split(";")) {
    const index = item.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();

    if (key === name) {
      return decodeURIComponent(value);
    }
  }

  return "";
}

function verifySession(token, secret) {
  if (!token || !secret) {
    return false;
  }

  const parts = String(token).split(".");

  if (parts.length !== 2) {
    return false;
  }

  const timestamp = parts[0];
  const signature = parts[1];

  if (!/^\d+$/.test(timestamp)) {
    return false;
  }

  const age = Date.now() - Number(timestamp);

  if (
    age < 0 ||
    age > 12 * 60 * 60 * 1000
  ) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update("checkin:" + timestamp)
    .digest("hex");

  return safeEqual(signature, expected);
}

function isAuthenticated(req) {
  const secret = getSecret();

  if (!secret) {
    return false;
  }

  // Compatibilidade com testes antigos.
  const headerSecret =
    req.headers["x-checkin-secret"];

  if (
    headerSecret &&
    safeEqual(headerSecret, secret)
  ) {
    return true;
  }

  // Sessão segura usada pela interface.
  const session =
    getCookie(req, "checkin_session");

  return verifySession(session, secret);
}

function getSupabaseConfig() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  return {
    url: String(url).replace(/\/+$/, ""),
    key: String(key)
  };
}

async function supabaseRpc(
  functionName,
  body
) {
  const { url, key } =
    getSupabaseConfig();

  if (!url || !key) {
    throw new Error(
      "Configuração do Supabase não encontrada."
    );
  }

  const response = await fetch(
    url +
      "/rest/v1/rpc/" +
      functionName,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization:
          "Bearer " + key,
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify(body)
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
    data = text;
  }

  if (!response.ok) {
    const detail =
      data &&
      typeof data === "object" &&
      (
        data.message ||
        data.error ||
        data.hint
      );

    const error =
      new Error(
        detail ||
        "Erro ao executar operação no Supabase."
      );

    error.status =
      response.status;

    error.data = data;

    throw error;
  }

  return data;
}

function normalizeRpcRow(data) {
  if (Array.isArray(data)) {
    return data[0] || null;
  }

  return data || null;
}

function cleanCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeAction(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export default async function handler(
  req,
  res
) {
  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  if (req.method !== "POST") {
    res.setHeader(
      "Allow",
      "POST"
    );

    return res.status(405).json({
      success: false,
      result: "METHOD_NOT_ALLOWED",
      message:
        "Método não permitido."
    });
  }

  if (!isAuthenticated(req)) {
    return res.status(401).json({
      success: false,
      result: "UNAUTHORIZED",
      message:
        "Acesso não autorizado."
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(
            req.body || "{}"
          )
        : (
            req.body || {}
          );

    const ticketCode =
      cleanCode(
        body.ticketCode ||
        body.ticket_code ||
        body.code
      );

    const action =
      normalizeAction(
        body.action
      );

    if (!ticketCode) {
      return res.status(400).json({
        success: false,
        result:
          "MISSING_TICKET_CODE",
        message:
          "Código do bilhete não informado."
      });
    }

    if (
      action !== "ENTRY" &&
      action !== "EXIT"
    ) {
      return res.status(400).json({
        success: false,
        result:
          "INVALID_ACTION",
        message:
          "A operação deve ser ENTRY ou EXIT."
      });
    }

    const rpcName =
      action === "ENTRY"
        ? "blackout_register_entry"
        : "blackout_register_exit";

    const data =
      await supabaseRpc(
        rpcName,
        {
          p_ticket_code:
            ticketCode
        }
      );

    const row =
      normalizeRpcRow(data);

    if (!row) {
      return res.status(500).json({
        success: false,
        result:
          "EMPTY_RPC_RESPONSE",
        message:
          "O Supabase não retornou o resultado do check-in."
      });
    }

    const success =
      row.success === true;

    let httpStatus =
      success ? 200 : 409;

    if (
      row.result ===
      "TICKET_NOT_FOUND"
    ) {
      httpStatus = 404;
    }

    if (
      row.result ===
      "PAYMENT_NOT_PAID"
    ) {
      httpStatus = 409;
    }

    if (
      row.result ===
      "CANCELLED"
    ) {
      httpStatus = 409;
    }

    return res.status(
      httpStatus
    ).json({
      success,
      result:
        row.result || "",
      message:
        row.message ||
        (
          success
            ? (
                action === "ENTRY"
                  ? "Entrada autorizada."
                  : "Saída registada."
              )
            : "Operação não autorizada."
        ),
      ticket: {
        ticketCode:
          row.ticket_code ||
          ticketCode,

        fullName:
          row.full_name || "",

        ticketType:
          row.ticket_type || "",

        ticketLot:
          row.ticket_lot || "",

        quantity:
          Number(
            row.quantity || 1
          ),

        ticketStatus:
          row.ticket_status || "",

        presenceStatus:
          row.presence_status || ""
      }
    });
  } catch (error) {
    console.error(
      "CHECKIN API ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      result:
        "SERVER_ERROR",
      message:
        "Erro interno ao processar o check-in."
    });
  }
}