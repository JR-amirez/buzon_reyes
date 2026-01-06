const Busboy = require("busboy");
const nodemailer = require("nodemailer");
const { PassThrough } = require("stream");

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    // 1) El body en Netlify puede venir en base64
    const bodyBuffer = Buffer.from(
      event.body || "",
      event.isBase64Encoded ? "base64" : "utf8"
    );

    // 2) Busboy necesita headers (en Netlify vienen en event.headers)
    const headers = event.headers || {};
    const bb = Busboy({
      headers,
      limits: { files: 1, fileSize: MAX_FILE_BYTES },
    });

    const fields = {};
    let fileBuffer = null;
    let fileName = null;
    let fileMime = null;

    bb.on("field", (name, val) => {
      fields[name] = val;
    });

    bb.on("file", (_name, file, info) => {
      fileName = info.filename;
      fileMime = info.mimeType;

      const chunks = [];
      file.on("data", (chunk) => chunks.push(chunk));
      file.on("limit", () => reject(new Error("El archivo excede 10MB.")));
      file.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    bb.on("error", reject);
    bb.on("finish", () => resolve({ fields, fileBuffer, fileName, fileMime }));

    // 3) Convertimos el buffer a stream y lo pasamos a Busboy
    const stream = new PassThrough();
    stream.end(bodyBuffer);
    stream.pipe(bb);
  });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { fields, fileBuffer, fileName, fileMime } = await parseMultipart(event);

    // Validaciones
    const mailboxName = fields.mailboxName;
    if (!mailboxName) return { statusCode: 400, body: "Falta mailboxName." };
    if (!fileBuffer || !fileName) return { statusCode: 400, body: "Falta el PDF." };
    if (fileMime !== "application/pdf") return { statusCode: 400, body: "Debe ser PDF." };

    // Destinos fijos (seguridad)
    const recipients = {
      Gulugu: process.env.TO_GULUGU,
      Davidcito: process.env.TO_DAVIDCITO,
    };
    const to = recipients[mailboxName];
    if (!to) return { statusCode: 400, body: "Buzón no reconocido." };

    // SMTP (mínimo indispensable)
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
      return { statusCode: 500, body: "Faltan variables SMTP." };
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465, // 465 SSL, 587 STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    const from = process.env.FROM_EMAIL || SMTP_USER;

    await transporter.sendMail({
      from,
      to,
      subject: `PDF recibido - ${mailboxName}`,
      text: `Se recibió un PDF desde "${mailboxName}".`,
      attachments: [
        {
          filename: fileName,
          content: fileBuffer, // adjunto directo (Buffer)
          contentType: "application/pdf",
        },
      ],
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err?.message || "Error" }),
    };
  }
};
