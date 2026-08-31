import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function sendJson(res, status, data) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");

  return res.end(JSON.stringify(data));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function supabaseRequest(path) {
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
      method: "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
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
      "Erro ao consultar o Supabase."
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

function renderPage({
  valid,
  title,
  message,
  ticket,
}) {
  const status = valid
    ? "BILHETE VÁLIDO"
    : "BILHETE INVÁLIDO";

  const ticketCode =
    ticket?.ticket_code || "";

  const name =
    ticket?.full_name || "";

  const type =
    ticket?.ticket_type || "";

  const lot =
    ticket?.ticket_lot || "";

  const quantity =
    ticket?.quantity || "";

  const paymentStatus =
    ticket?.payment_status || "";

  const statusClass = valid
    ? "valid"
    : "invalid";

  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >

  <title>${escapeHtml(status)}</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      font-family: Arial, sans-serif;
      background: #111;
      color: #fff;
    }

    .card {
      width: 100%;
      max-width: 480px;
      background: #fff;
      color: #111;
      border-radius: 18px;
      padding: 28px;
      box-shadow: 0 20px 60px rgba(0,0,0,.35);
    }

    .status {
      text-align: center;
      font-size: 25px;
      font-weight: 800;
      margin-bottom: 12px;
    }

    .valid {
      color: #16803c;
    }

    .invalid {
      color: #c62828;
    }

    .message {
      text-align: center;
      margin-bottom: 24px;
      color: #555;
    }

    .row {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      padding: 11px 0;
      border-bottom: 1px solid #eee;
    }

    .label {
      color: #777;
    }

    .value {
      font-weight: 700;
      text-align: right;
    }

    .code {
      margin-top: 24px;
      padding: 14px;
      border-radius: 10px;
      background: #f4f4f4;
      text-align: center;
      font-family: monospace;
      font-weight: 800;
      word-break: break-all;
    }

    .footer {
      margin-top: 24px;
      text-align: center;
      font-size: 12px;
      color: #777;
    }
  </style>
</head>

<body>
  <main class="card">

    <div class="status ${statusClass}">
      ${escapeHtml(status)}
    </div>

    <div class="message">
      ${escapeHtml(message)}
    </div>

    ${
      valid
        ? `
          <div class="row">
            <span class="label">Nome</span>
            <span class="value">
              ${escapeHtml(name)}
            </span>
          </div>

          <div class="row">
            <span class="label">Bilhete</span>
            <span class="value">
              ${escapeHtml(type)}
            </span>
          </div>

          <div class="row">
            <span class="label">Lote</span>
            <span class="value">
              ${escapeHtml(lot)}
            </span>
          </div>

          <div class="row">
            <span class="label">Quantidade</span>
            <span class="value">
              ${escapeHtml(quantity)}
            </span>
          </div>

          <div class="row">
            <span class="label">Pagamento</span>
            <span class="value">
              ${escapeHtml(paymentStatus)}
            </span>
          </div>

          <div class="code">
            ${escapeHtml(ticketCode)}
          </div>
        `
        : ""
    }

    <div class="footer">
      BLACK OUT — AMAPIANO EDITION
    </div>

  </main>
</body>
</html>`;
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "GET") {
    return sendJson(res, 405, {
      success: false,
      message: "Método não permitido.",
    });
  }

  try {
    const rawCode =
      req.query?.code;

    const ticketCode =
      typeof rawCode === "string"
        ? rawCode.trim()
        : "";

    if (!ticketCode) {
      res.status(400);
      res.setHeader(
        "Content-Type",
        "text/html; charset=utf-8"
      );

      return res.end(
        renderPage({
          valid: false,
          title: "Bilhete inválido",
          message:
            "Código do bilhete não informado.",
        })
      );
    }

    const rows =
      await supabaseRequest(
        `blackout_orders?ticket_code=eq.${encodeURIComponent(
          ticketCode
        )}&limit=1`
      );

    if (
      !Array.isArray(rows) ||
      rows.length === 0
    ) {
      res.status(404);
      res.setHeader(
        "Content-Type",
        "text/html; charset=utf-8"
      );

      return res.end(
        renderPage({
          valid: false,
          title: "Bilhete inválido",
          message:
            "Este código não foi encontrado.",
        })
      );
    }

    const ticket =
      rows[0];

    const paymentStatus =
      String(
        ticket.payment_status || ""
      ).toUpperCase();

    const ticketStatus =
      String(
        ticket.ticket_status || ""
      ).toUpperCase();

    /*
     * O bilhete só é válido quando:
     *
     * 1. pagamento = PAID
     * 2. bilhete = ISSUED
     */

    const valid =
      paymentStatus === "PAID" &&
      ticketStatus === "ISSUED";

    if (!valid) {
      res.status(409);
      res.setHeader(
        "Content-Type",
        "text/html; charset=utf-8"
      );

      return res.end(
        renderPage({
          valid: false,
          title: "Bilhete inválido",
          message:
            "O pagamento deste bilhete não está confirmado ou o bilhete ainda não foi emitido.",
          ticket,
        })
      );
    }

    res.status(200);
    res.setHeader(
      "Content-Type",
      "text/html; charset=utf-8"
    );

    return res.end(
      renderPage({
        valid: true,
        title: "Bilhete válido",
        message:
          "Pagamento confirmado. Bilhete autorizado.",
        ticket,
      })
    );

  } catch (error) {
    console.error(
      "VERIFY TICKET ERROR:",
      error
    );

    return sendJson(res, 500, {
      success: false,
      message:
        "Não foi possível verificar o bilhete.",
    });
  }
}
