const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function sendJson(res, status, data) {
  return res.status(status).json(data);
}

async function supabaseRequest(path, options = {}) {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Variáveis do Supabase não configuradas"
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
        "Erro no Supabase"
    );

    error.status = response.status;
    throw error;
  }

  return data;
}

async function createSignedPdfUrl(pdfPath) {
  if (!pdfPath) {
    return null;
  }

  const cleanPath = String(pdfPath)
    .replace(/^\/+/, "");

  const encodedPath = cleanPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/tickets/${encodedPath}`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expiresIn: 3600,
      }),
    }
  );

  const text = await response.text();

  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    console.error(
      "SUPABASE STORAGE SIGN ERROR:",
      response.status,
      data || text
    );

    throw new Error(
      "Não foi possível preparar o download do bilhete."
    );
  }

  if (!data?.signedURL) {
    throw new Error(
      "Supabase não devolveu a URL segura do bilhete."
    );
  }

  const signedUrl = data.signedURL.startsWith("http")
    ? data.signedURL
    : `${SUPABASE_URL}/storage/v1${data.signedURL}`;

  return signedUrl;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, {
      success: false,
      message: "Método não permitido",
    });
  }

  try {
    const reference =
      typeof req.query?.reference === "string"
        ? req.query.reference.trim()
        : "";

    if (!reference) {
      return sendJson(res, 400, {
        success: false,
        message: "Referência do pedido não informada.",
      });
    }

    if (
      reference.length < 5 ||
      reference.length > 100 ||
      !/^[A-Za-z0-9_-]+$/.test(reference)
    ) {
      return sendJson(res, 400, {
        success: false,
        message: "Referência do pedido inválida.",
      });
    }

    const orders = await supabaseRequest(
      `blackout_orders?order_reference=eq.${encodeURIComponent(
        reference
      )}&select=order_reference,payment_status,ticket_status,pdf_path,ticket_code,quantity&limit=1`,
      {
        method: "GET",
      }
    );

    if (
      !Array.isArray(orders) ||
      orders.length === 0
    ) {
      return sendJson(res, 404, {
        success: false,
        message: "Pedido não encontrado.",
      });
    }

    const order = orders[0];

    const paymentStatus =
      String(order.payment_status || "").toUpperCase();

    const ticketStatus =
      String(order.ticket_status || "").toUpperCase();

    if (paymentStatus !== "PAID") {
      return sendJson(res, 200, {
        success: true,
        ready: false,
        paymentStatus,
        ticketStatus,
        orderReference:
          order.order_reference,
        message:
          paymentStatus === "FAILED"
            ? "O pagamento não foi confirmado."
            : "Aguardando confirmação do pagamento.",
      });
    }

    if (
      ticketStatus !== "ISSUED" ||
      !order.pdf_path
    ) {
      return sendJson(res, 200, {
        success: true,
        ready: false,
        paymentStatus,
        ticketStatus,
        orderReference:
          order.order_reference,
        message:
          "Pagamento confirmado. O bilhete está sendo preparado.",
      });
    }

    const pdfUrl =
      await createSignedPdfUrl(
        order.pdf_path
      );

    return sendJson(res, 200, {
      success: true,
      ready: true,
      paymentStatus,
      ticketStatus,
      orderReference:
        order.order_reference,
      quantity: Number(order.quantity || 1),
      ticketCode:
        order.ticket_code || null,
      pdfUrl,
      message:
        "Pagamento confirmado. Seu bilhete está pronto.",
    });
  } catch (error) {
    console.error(
      "ORDER STATUS ERROR:",
      error
    );

    return sendJson(res, 500, {
      success: false,
      message:
        "Não foi possível consultar o estado do pedido.",
    });
  }
}
