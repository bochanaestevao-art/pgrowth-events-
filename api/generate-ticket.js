import crypto from "node:crypto";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SITE_URL =
  process.env.SITE_URL ||
  "https://SEU-DOMINIO.vercel.app";

function json(res, status, data) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify(data));
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,

      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,

        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

        "Content-Type":
          "application/json",

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
      "Erro no Supabase."
    );

    error.status =
      response.status;

    error.data = data;

    throw error;
  }

  return data;
}

function generateTicketCode() {
  const random =
    crypto.randomBytes(8)
      .toString("hex")
      .toUpperCase();

  return `BLACKOUT-2026-${random}`;
}

function createPdf({
  ticket,
  qrBuffer,
}) {
  return new Promise(
    (resolve, reject) => {
      const doc =
        new PDFDocument({
          size: "A5",
          margin: 36,
        });

      const chunks = [];

      doc.on("data", chunk => {
        chunks.push(chunk);
      });

      doc.on("end", () => {
        resolve(
          Buffer.concat(chunks)
        );
      });

      doc.on("error", reject);

      /*
       * -----------------------------------------
       * CABEÇALHO
       * -----------------------------------------
       */

      doc
        .fontSize(24)
        .text(
          "BLACK OUT",
          {
            align: "center",
          }
        );

      doc
        .moveDown(0.2)
        .fontSize(13)
        .text(
          "AMAPIANO EDITION",
          {
            align: "center",
          }
        );

      doc.moveDown();

      /*
       * -----------------------------------------
       * LINHA
       * -----------------------------------------
       */

      doc
        .moveTo(36, doc.y)
        .lineTo(369, doc.y)
        .stroke();

      doc.moveDown();

      /*
       * -----------------------------------------
       * DADOS DO BILHETE
       * -----------------------------------------
       */

      doc
        .fontSize(11)
        .text(
          `Nome: ${ticket.full_name}`
        );

      doc
        .text(
          `Bilhete: ${ticket.ticket_type}`
        );

      doc
        .text(
          `Lote: ${ticket.ticket_lot}`
        );

      doc
        .text(
          `Quantidade: ${ticket.quantity}`
        );

      doc
        .text(
          `Valor: ${ticket.total_amount} MZN`
        );

      doc
        .text(
          `Método: ${ticket.payment_method}`
        );

      doc.moveDown();

      /*
       * -----------------------------------------
       * STATUS
       * -----------------------------------------
       */

      doc
        .fontSize(14)
        .text(
          "PAGAMENTO CONFIRMADO",
          {
            align: "center",
          }
        );

      doc.moveDown();

      /*
       * -----------------------------------------
       * QR CODE
       * -----------------------------------------
       */

      doc.image(
        qrBuffer,
        {
          fit: [180, 180],
          align: "center",
        }
      );

      doc.moveDown();

      /*
       * -----------------------------------------
       * CÓDIGO
       * -----------------------------------------
       */

      doc
        .fontSize(10)
        .text(
          ticket.ticket_code,
          {
            align: "center",
          }
        );

      doc.moveDown();

      doc
        .fontSize(8)
        .text(
          "Apresente este QR Code na entrada.",
          {
            align: "center",
          }
        );

      doc
        .text(
          "Bilhete válido somente após confirmação do pagamento.",
          {
            align: "center",
          }
        );

      doc.end();
    }
  );
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      message:
        "Método não permitido.",
    });
  }

  try {
    /*
     * -----------------------------------------
     * 1. RECEBER REFERÊNCIA
     * -----------------------------------------
     */

    const {
      orderReference,
    } = req.body || {};

    if (!orderReference) {
      return json(res, 400, {
        success: false,
        message:
          "orderReference é obrigatório.",
      });
    }

    /*
     * -----------------------------------------
     * 2. BUSCAR PEDIDO
     * -----------------------------------------
     */

    const orders =
      await supabaseRequest(
        `blackout_orders?order_reference=eq.${encodeURIComponent(
          orderReference
        )}&limit=1`,
        {
          method: "GET",
        }
      );

    if (
      !Array.isArray(orders) ||
      orders.length === 0
    ) {
      return json(res, 404, {
        success: false,
        message:
          "Pedido não encontrado.",
      });
    }

    const order =
      orders[0];

    /*
     * -----------------------------------------
     * 3. SEGURANÇA
     * -----------------------------------------
     *
     * Nunca emitir bilhete para pagamento
     * que não esteja confirmado.
     */

    if (
      String(
        order.payment_status
      ).toUpperCase() !== "PAID"
    ) {
      return json(res, 409, {
        success: false,
        message:
          "O pagamento ainda não foi confirmado.",
      });
    }

    /*
     * -----------------------------------------
     * 4. SE JÁ EXISTE BILHETE
     * -----------------------------------------
     */

    if (
      order.ticket_code &&
      order.pdf_path
    ) {
      return json(res, 200, {
        success: true,
        alreadyGenerated: true,

        ticketCode:
          order.ticket_code,

        pdfPath:
          order.pdf_path,
      });
    }

    /*
     * -----------------------------------------
     * 5. GERAR CÓDIGO
     * -----------------------------------------
     */

    const ticketCode =
      order.ticket_code ||
      generateTicketCode();

    const verificationUrl =
      `${SITE_URL}/api/verify-ticket?code=${encodeURIComponent(
        ticketCode
      )}`;

    /*
     * -----------------------------------------
     * 6. GERAR QR
     * -----------------------------------------
     */

    const qrBuffer =
      await QRCode.toBuffer(
        verificationUrl,
        {
          type: "png",
          width: 600,
          margin: 2,
          errorCorrectionLevel: "H",
        }
      );

    /*
     * -----------------------------------------
     * 7. GERAR PDF
     * -----------------------------------------
     */

    const pdfBuffer =
      await createPdf({
        ticket: {
          ...order,
          ticket_code:
            ticketCode,
        },

        qrBuffer,
      });

    /*
     * -----------------------------------------
     * 8. CAMINHO DO PDF
     * -----------------------------------------
     */

    const pdfPath =
      `tickets/${ticketCode}.pdf`;

    /*
     * -----------------------------------------
     * 9. UPLOAD PARA SUPABASE STORAGE
     * -----------------------------------------
     */

    const uploadResponse =
      await fetch(
        `${SUPABASE_URL}/storage/v1/object/tickets/${pdfPath}`,
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

    if (!uploadResponse.ok) {
      const errorText =
        await uploadResponse.text();

      throw new Error(
        `Erro ao guardar PDF: ${errorText}`
      );
    }

    /*
     * -----------------------------------------
     * 10. ATUALIZAR PEDIDO
     * -----------------------------------------
     */

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
            ticketCode,

          ticket_status:
            "ISSUED",

          qr_data:
            verificationUrl,

          pdf_path:
            pdfPath,
        }),
      }
    );

    /*
     * -----------------------------------------
     * 11. RESPOSTA
     * -----------------------------------------
     */

    return json(res, 200, {
      success: true,

      ticketCode,

      pdfPath,

      verificationUrl,
    });

  } catch (error) {
    console.error(
      "GENERATE TICKET ERROR:",
      error
    );

    return json(res, 500, {
      success: false,
      message:
        "Não foi possível gerar o bilhete.",
    });
  }
}
