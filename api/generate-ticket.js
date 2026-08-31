import crypto from "node:crypto";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SITE_URL = process.env.SITE_URL;

const TICKET_GENERATION_SECRET =
  process.env.TICKET_GENERATION_SECRET;

function sendJson(res, status, data) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");

  return res.end(
    JSON.stringify(data)
  );
}

/*
 * =========================================================
 * SUPABASE
 * =========================================================
 */

async function supabaseRequest(
  path,
  options = {}
) {
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
        apikey:
          SUPABASE_SERVICE_ROLE_KEY,

        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

        "Content-Type":
          "application/json",

        ...(options.headers || {}),
      },
    }
  );

  const text =
    await response.text();

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
      "Erro ao comunicar com o Supabase."
    );

    error.status =
      response.status;

    error.data = data;

    throw error;
  }

  return data;
}

/*
 * =========================================================
 * GERAR CÓDIGO ÚNICO DO BILHETE
 * =========================================================
 */

function generateTicketCode() {
  const random =
    crypto
      .randomBytes(10)
      .toString("hex")
      .toUpperCase();

  return `BLACKOUT-2026-${random}`;
}

/*
 * =========================================================
 * GERAR PDF
 * =========================================================
 */

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
          info: {
            Title:
              "BLACK OUT — AMAPIANO EDITION",
            Author:
              "BLACK OUT",
            Subject:
              "Bilhete de entrada",
          },
        });

      const chunks = [];

      doc.on(
        "data",
        (chunk) => {
          chunks.push(chunk);
        }
      );

      doc.on(
        "end",
        () => {
          resolve(
            Buffer.concat(chunks)
          );
        }
      );

      doc.on(
        "error",
        reject
      );

      /*
       * -----------------------------------------------------
       * CABEÇALHO
       * -----------------------------------------------------
       */

      doc
        .fontSize(26)
        .font("Helvetica-Bold")
        .text(
          "BLACK OUT",
          {
            align: "center",
          }
        );

      doc
        .moveDown(0.3)
        .fontSize(14)
        .font("Helvetica")
        .text(
          "AMAPIANO EDITION",
          {
            align: "center",
          }
        );

      doc.moveDown();

      doc
        .moveTo(36, doc.y)
        .lineTo(369, doc.y)
        .stroke();

      doc.moveDown();

      /*
       * -----------------------------------------------------
       * INFORMAÇÕES
       * -----------------------------------------------------
       */

      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .text("DETALHES DO BILHETE");

      doc.moveDown(0.5);

      doc
        .font("Helvetica")
        .fontSize(10)
        .text(
          `Nome: ${ticket.full_name || "-"}`
        );

      doc.text(
        `Bilhete: ${ticket.ticket_type || "-"}`
      );

      doc.text(
        `Lote: ${ticket.ticket_lot || "-"}`
      );

      doc.text(
        `Quantidade: ${ticket.quantity || 1}`
      );

      doc.text(
        `Valor pago: ${ticket.total_amount || 0} MZN`
      );

      doc.text(
        `Método: ${ticket.payment_method || "-"}`
      );

      doc.moveDown();

      /*
       * -----------------------------------------------------
       * STATUS
       * -----------------------------------------------------
       */

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

      /*
       * -----------------------------------------------------
       * QR CODE
       * -----------------------------------------------------
       */

      doc.image(
        qrBuffer,
        {
          fit: [190, 190],
          align: "center",
        }
      );

      doc.moveDown();

      /*
       * -----------------------------------------------------
       * CÓDIGO DO BILHETE
       * -----------------------------------------------------
       */

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

      doc.end();
    }
  );
}

/*
 * =========================================================
 * HANDLER
 * =========================================================
 */

export default async function handler(
  req,
  res
) {
  /*
   * -------------------------------------------------------
   * SOMENTE POST
   * -------------------------------------------------------
   */

  if (req.method !== "POST") {
    return sendJson(res, 405, {
      success: false,
      message:
        "Método não permitido.",
    });
  }

  try {
    /*
     * -----------------------------------------------------
     * CONFIGURAÇÕES OBRIGATÓRIAS
     * -----------------------------------------------------
     */

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

    /*
     * -----------------------------------------------------
     * AUTORIZAÇÃO INTERNA
     * -----------------------------------------------------
     *
     * Apenas o nosso webhook deve conseguir chamar
     * esta função.
     */

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

    /*
     * -----------------------------------------------------
     * RECEBER ORDER REFERENCE
     * -----------------------------------------------------
     */

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

    /*
     * -----------------------------------------------------
     * BUSCAR PEDIDO
     * -----------------------------------------------------
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
      return sendJson(res, 404, {
        success: false,
        message:
          "Pedido não encontrado.",
      });
    }

    const order =
      orders[0];

    /*
     * -----------------------------------------------------
     * CONFIRMAR PAGAMENTO
     * -----------------------------------------------------
     *
     * Nunca gerar bilhete para um pedido que não esteja
     * realmente PAID.
     */

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

    /*
     * -----------------------------------------------------
     * SE JÁ TEM BILHETE, NÃO GERAR OUTRO
     * -----------------------------------------------------
     */

    if (
      order.ticket_code &&
      order.pdf_path
    ) {
      return sendJson(res, 200, {
        success: true,
        alreadyGenerated: true,

        ticketCode:
          order.ticket_code,

        pdfPath:
          order.pdf_path,

        qrData:
          order.qr_data || null,
      });
    }

    /*
     * -----------------------------------------------------
     * GERAR CÓDIGO ÚNICO
     * -----------------------------------------------------
     */

    let ticketCode =
      order.ticket_code;

    if (!ticketCode) {
      ticketCode =
        generateTicketCode();
    }

    /*
     * -----------------------------------------------------
     * URL DE VERIFICAÇÃO
     * -----------------------------------------------------
     */

    const verificationUrl =
      `${SITE_URL}/api/verify-ticket?code=${encodeURIComponent(
        ticketCode
      )}`;

    /*
     * -----------------------------------------------------
     * GERAR QR CODE
     * -----------------------------------------------------
     */

    const qrBuffer =
      await QRCode.toBuffer(
        verificationUrl,
        {
          type: "png",

          width: 600,

          margin: 2,

          errorCorrectionLevel:
            "H",
        }
      );

    /*
     * -----------------------------------------------------
     * GERAR PDF
     * -----------------------------------------------------
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
     * -----------------------------------------------------
     * CAMINHO DO PDF
     * -----------------------------------------------------
     */

    const pdfPath =
      `tickets/${ticketCode}.pdf`;

    /*
     * -----------------------------------------------------
     * UPLOAD PARA SUPABASE STORAGE
     * -----------------------------------------------------
     */

    const uploadResponse =
      await fetch(
        `${SUPABASE_URL}/storage/v1/object/tickets/${ticketCode}.pdf`,
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
      !uploadResponse.ok
    ) {
      const errorText =
        await uploadResponse.text();

      /*
       * Se o arquivo já existir, não vamos criar
       * outro arquivo com o mesmo nome.
       */

      if (
        uploadResponse.status !==
        409
      ) {
        throw new Error(
          `Erro ao guardar PDF no Storage: ${errorText}`
        );
      }
    }

    /*
     * -----------------------------------------------------
     * ATUALIZAR PEDIDO
     * -----------------------------------------------------
     */

    const updated =
      await supabaseRequest(
        `blackout_orders?order_reference=eq.${encodeURIComponent(
          orderReference
        )}&ticket_code=is.null`,
        {
          method: "PATCH",

          headers: {
            Prefer:
              "return=representation",
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

            paid_at:
              order.paid_at ||
              new Date().toISOString(),
          }),
        }
      );

    /*
     * -----------------------------------------------------
     * VERIFICAR SE A ATUALIZAÇÃO ACONTECEU
     * -----------------------------------------------------
     */

    if (
      !Array.isArray(updated) ||
      updated.length === 0
    ) {
      /*
       * Outro processo pode ter emitido o bilhete
       * simultaneamente.
       *
       * Buscamos novamente o pedido.
       */

      const existing =
        await supabaseRequest(
          `blackout_orders?order_reference=eq.${encodeURIComponent(
            orderReference
          )}&limit=1`,
          {
            method: "GET",
          }
        );

      const existingOrder =
        existing?.[0];

      if (
        existingOrder?.ticket_code &&
        existingOrder?.pdf_path
      ) {
        return sendJson(res, 200, {
          success: true,
          alreadyGenerated: true,

          ticketCode:
            existingOrder.ticket_code,

          pdfPath:
            existingOrder.pdf_path,

          qrData:
            existingOrder.qr_data ||
            null,
        });
      }

      throw new Error(
        "Não foi possível registrar o bilhete no pedido."
      );
    }

    /*
     * -----------------------------------------------------
     * SUCESSO
     * -----------------------------------------------------
     */

    return sendJson(res, 200, {
      success: true,

      alreadyGenerated: false,

      ticketCode,

      pdfPath,

      qrData:
        verificationUrl,

      message:
        "Bilhete gerado com sucesso.",
    });

  } catch (error) {
    console.error(
      "GENERATE TICKET ERROR:",
      error
    );

    return sendJson(res, 500, {
      success: false,

      message:
        "Não foi possível gerar o bilhete.",
    });
  }
}
