import crypto from "node:crypto";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SITE_URL =
  process.env.SITE_URL ||
  "https://pgrowth-events.vercel.app";

const TICKET_GENERATION_SECRET =
  process.env.TICKET_GENERATION_SECRET;

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
      "Credenciais do Supabase não configuradas."
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
        "Erro ao comunicar com o Supabase."
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

function generateTicketCode() {
  const random = crypto
    .randomBytes(10)
    .toString("hex")
    .toUpperCase();

  return `BLACKOUT-2026-${random}`;
}

function createPdf({
  tickets,
  qrBuffers,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A5",
      margin: 36,
      info: {
        Title:
          "BLACK OUT — AMAPIANO EDITION",
        Author: "BLACK OUT",
        Subject:
          "Bilhetes de entrada",
      },
    });

    const chunks = [];

    doc.on("data", (chunk) => {
      chunks.push(chunk);
    });

    doc.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    doc.on("error", reject);

    tickets.forEach((ticket, index) => {
      if (index > 0) {
        doc.addPage();
      }

      doc
        .fontSize(26)
        .font("Helvetica-Bold")
        .text("BLACK OUT", {
          align: "center",
        });

      doc
        .moveDown(0.3)
        .fontSize(14)
        .font("Helvetica")
        .text("AMAPIANO EDITION", {
          align: "center",
        });

      doc.moveDown();

      doc
        .moveTo(36, doc.y)
        .lineTo(369, doc.y)
        .stroke();

      doc.moveDown();

      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .text("DETALHES DO BILHETE");

      doc.moveDown(0.5);

      doc
        .font("Helvetica")
        .fontSize(10);

      doc.text(
        `Nome: ${ticket.full_name || "-"}`
      );

      doc.text(
        `Bilhete: ${
          ticket.ticket_type || "-"
        }`
      );

      doc.text(
        `Lote: ${
          ticket.ticket_lot || "-"
        }`
      );

      doc.text(
        `Bilhete ${
          ticket.ticket_number
        } de ${tickets.length}`
      );

      doc.text(
        `Valor deste bilhete: ${
          ticket.ticket_price || 0
        } MZN`
      );

      doc.text(
        `Total da compra: ${
          ticket.total_amount || 0
        } MZN`
      );

      doc.text(
        `Método: ${
          ticket.payment_method || "-"
        }`
      );

      doc.moveDown();

      doc
        .fontSize(13)
        .font("Helvetica-Bold")
        .text(
          "PAGAMENTO CONFIRMADO",
          {
            align: "center",
          }
        );

      doc.moveDown();

      doc.image(qrBuffers[index], {
        fit: [190, 190],
        align: "center",
      });

      doc.moveDown();

      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .text(
          ticket.ticket_code,
          {
            align: "center",
          }
        );

      doc.moveDown(0.7);

      doc
        .fontSize(8)
        .font("Helvetica")
        .text(
          "Apresente este QR Code na entrada do evento.",
          {
            align: "center",
          }
        );

      doc.text(
        "Este bilhete só é válido após confirmação do pagamento.",
        {
          align: "center",
        }
      );
    });

    doc.end();
  });
}

async function getOrder(
  orderReference
) {
  const orders =
    await supabaseRequest(
      `blackout_orders?order_reference=eq.${encodeURIComponent(
        orderReference
      )}&limit=1`,
      {
        method: "GET",
      }
    );

  return Array.isArray(orders) &&
    orders.length
    ? orders[0]
    : null;
}

async function getIndividualTickets(
  orderReference
) {
  const rows =
    await supabaseRequest(
      `blackout_order_tickets?order_reference=eq.${encodeURIComponent(
        orderReference
      )}&order=ticket_number.asc`,
      {
        method: "GET",
      }
    );

  return Array.isArray(rows)
    ? rows
    : [];
}

async function createIndividualTicket(
  order,
  ticketNumber
) {
  const ticketCode =
    generateTicketCode();

  const verificationUrl =
    `${SITE_URL}/api/verify-ticket?code=` +
    encodeURIComponent(ticketCode);

  const row = {
    order_reference:
      order.order_reference,

    ticket_code:
      ticketCode,

    ticket_number:
      ticketNumber,

    ticket_type:
      order.ticket_type,

    ticket_lot:
      order.ticket_lot,

    ticket_price:
      Number(order.ticket_price),

    ticket_status:
      "ISSUED",

    presence_status:
      "OUTSIDE",

    qr_data:
      verificationUrl,
  };

  const inserted =
    await supabaseRequest(
      "blackout_order_tickets",
      {
        method: "POST",

        headers: {
          Prefer:
            "return=representation",
        },

        body: JSON.stringify(row),
      }
    );

  return Array.isArray(inserted)
    ? inserted[0]
    : inserted;
}

async function uploadPdf(
  pdfBuffer,
  pdfPath
) {
  const objectPath =
    pdfPath.replace(
      /^tickets\//,
      ""
    );

  const response =
    await fetch(
      `${SUPABASE_URL}/storage/v1/object/tickets/${encodeURIComponent(
        objectPath
      )}`,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

          apikey:
            SUPABASE_SERVICE_ROLE_KEY,

          "Content-Type":
            "application/pdf",

          "x-upsert":
            "false",
        },

        body: pdfBuffer,
      }
    );

  if (
    !response.ok &&
    response.status !== 409
  ) {
    const text =
      await response.text();

    throw new Error(
      `Erro ao guardar PDF no Storage: ${text}`
    );
  }
}

async function updateOrderTicketSummary(
  orderReference,
  firstTicket,
  pdfPath
) {
  await supabaseRequest(
    `blackout_orders?order_reference=eq.${encodeURIComponent(
      orderReference
    )}`,
    {
      method: "PATCH",

      headers: {
        Prefer:
          "return=minimal",
      },

      body: JSON.stringify({
        ticket_code:
          firstTicket.ticket_code,

        ticket_status:
          "ISSUED",

        qr_data:
          firstTicket.qr_data,

        pdf_path:
          pdfPath,

        paid_at:
          new Date().toISOString(),
      }),
    }
  );
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return sendJson(res, 405, {
      success: false,
      message:
        "Método não permitido.",
    });
  }

  try {
    if (!SITE_URL) {
      throw new Error(
        "SITE_URL não configurado."
      );
    }

    if (!TICKET_GENERATION_SECRET) {
      throw new Error(
        "TICKET_GENERATION_SECRET não configurado."
      );
    }

    const internalSecret =
      req.headers[
        "x-ticket-generation-secret"
      ];

    if (
      !internalSecret ||
      internalSecret !==
        TICKET_GENERATION_SECRET
    ) {
      return sendJson(res, 401, {
        success: false,
        message:
          "Não autorizado.",
      });
    }

    const body =
      req.body || {};

    const orderReference =
      typeof body.orderReference ===
      "string"
        ? body.orderReference.trim()
        : "";

    if (!orderReference) {
      return sendJson(res, 400, {
        success: false,
        message:
          "orderReference é obrigatório.",
      });
    }

    const order =
      await getOrder(
        orderReference
      );

    if (!order) {
      return sendJson(res, 404, {
        success: false,
        message:
          "Pedido não encontrado.",
      });
    }

    const paymentStatus =
      String(
        order.payment_status || ""
      ).toUpperCase();

    if (
      paymentStatus !== "PAID"
    ) {
      return sendJson(res, 409, {
        success: false,
        message:
          "O pagamento ainda não está confirmado.",
        paymentStatus,
      });
    }

    const quantity = Math.max(
      1,
      Math.min(
        10,
        Number(order.quantity) || 1
      )
    );

    let tickets =
      await getIndividualTickets(
        orderReference
      );

    for (
      let number =
        tickets.length + 1;
      number <= quantity;
      number++
    ) {
      const created =
        await createIndividualTicket(
          order,
          number
        );

      tickets.push(created);
    }

    tickets = tickets
      .sort(
        (a, b) =>
          Number(
            a.ticket_number
          ) -
          Number(
            b.ticket_number
          )
      )
      .slice(0, quantity);

    if (
      tickets.length !==
      quantity
    ) {
      throw new Error(
        "Não foi possível criar todos os bilhetes individuais."
      );
    }

    const qrBuffers = [];

    for (
      const ticket of tickets
    ) {
      qrBuffers.push(
        await QRCode.toBuffer(
          ticket.qr_data,
          {
            type: "png",
            width: 600,
            margin: 2,
            errorCorrectionLevel:
              "H",
          }
        )
      );
    }

    const pdfPath =
      `tickets/${tickets[0].ticket_code}.pdf`;

    const pdfBuffer =
      await createPdf({
        tickets:
          tickets.map(
            (ticket) => ({
              ...order,
              ...ticket,

              total_amount:
                order.total_amount,

              payment_method:
                order.payment_method,
            })
          ),

        qrBuffers,
      });

    await uploadPdf(
      pdfBuffer,
      pdfPath
    );

    await updateOrderTicketSummary(
      orderReference,
      tickets[0],
      pdfPath
    );

    return sendJson(res, 200, {
      success: true,

      alreadyGenerated:
        Boolean(
          order.pdf_path
        ),

      orderReference,

      quantity,

      ticketCode:
        tickets[0].ticket_code,

      ticketCodes:
        tickets.map(
          (ticket) =>
            ticket.ticket_code
        ),

      pdfPath,

      qrData:
        tickets.map(
          (ticket) =>
            ticket.qr_data
        ),

      message:
        "Bilhetes gerados com sucesso.",
    });
  } catch (error) {
    console.error(
      "GENERATE TICKET ERROR:",
      error
    );

    return sendJson(res, 500, {
      success: false,

      message:
        error?.message ||
        "Não foi possível gerar os bilhetes.",
    });
  }
}