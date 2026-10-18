const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function sendJson(res, status, data) {
  return res.status(status).json(data);
}

async function supabaseRequest(path) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Variáveis do Supabase não configuradas");
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      method: "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error("Não foi possível consultar o pedido.");
  }

  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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
      `blackout_orders?order_reference=eq.${encodeURIComponent(reference)}` +
      `&select=order_reference,payment_status,ticket_status,pdf_path&limit=1`
    );

    if (!Array.isArray(orders) || orders.length === 0) {
      return sendJson(res, 404, {
        success: false,
        message: "Pedido não encontrado.",
      });
    }

    const order = orders[0];

    if (
      String(order.payment_status).toUpperCase() !== "PAID" ||
      String(order.ticket_status).toUpperCase() !== "ISSUED" ||
      typeof order.pdf_path !== "string" ||
      !order.pdf_path
    ) {
      return sendJson(res, 403, {
        success: false,
        message: "O bilhete ainda não está disponível.",
      });
    }

    let objectPath = order.pdf_path.replace(/^\/+/, "");

    if (objectPath.startsWith("tickets/")) {
      objectPath = objectPath.slice("tickets/".length);
    }

    if (
      !objectPath ||
      objectPath.split("/").some(
        part => !part || part === "." || part === ".."
      ) ||
      !/^[A-Za-z0-9_.-]+$/.test(objectPath)
    ) {
      return sendJson(res, 400, {
        success: false,
        message: "Caminho do bilhete inválido.",
      });
    }

    const encodedPath = objectPath
      .split("/")
      .map(encodeURIComponent)
      .join("/");

    const pdfResponse = await fetch(
      `${SUPABASE_URL}/storage/v1/object/tickets/${encodedPath}`,
      {
        method: "GET",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!pdfResponse.ok) {
      console.error(
        "TICKET PDF DOWNLOAD ERROR:",
        pdfResponse.status
      );

      return sendJson(res, 502, {
        success: false,
        message: "Não foi possível obter o PDF. Tente novamente.",
      });
    }

    const contentType =
      pdfResponse.headers.get("content-type") || "";

    if (!contentType.toLowerCase().includes("application/pdf")) {
      return sendJson(res, 502, {
        success: false,
        message: "O ficheiro recebido não é um PDF válido.",
      });
    }

    const pdf = Buffer.from(await pdfResponse.arrayBuffer());

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="bilhete-pgrowth.pdf"'
    );
    res.setHeader("Content-Length", String(pdf.length));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    return res.status(200).send(pdf);
  } catch (error) {
    console.error("TICKET PDF DOWNLOAD ERROR:", error.message);

    return sendJson(res, 500, {
      success: false,
      message: "Erro ao descarregar o bilhete.",
    });
  }
}
