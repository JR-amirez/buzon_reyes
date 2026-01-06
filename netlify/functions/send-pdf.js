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
            Gulugu: process.env.TO_DAVIDCITO,
            Davidcito: process.env.TO_GULUGU,
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

        // Emojis y textos según buzón (puedes ajustar nombres si quieres)
        const displayName = mailboxName === "Gulugu" ? "Gulugu 💜" : "Davidcito 💚";

        await transporter.sendMail({
            from,
            to,
            subject: `👑✨ Día de Reyes: PDF recibido para ${displayName}`,
            text:
                `¡Hola!\n\n` +
                `🎁👑 Haz recibido una carta enviada desde el buzón navideño de ${displayName}.\n\n` +
                `📎 Archivo adjunto: ${fileName}\n\n` +
                `Que esta temporada esté llena de alegría, salud y buenos deseos.\n` +
                `✨ ¡Feliz Día de Reyes!\n\n`,
            // (Opcional) Versión HTML para que se vea más bonito en clientes modernos
            html: `
    <div style="font-family: Arial, sans-serif; line-height:1.5; color:#111;">
      <h2 style="margin:0 0 8px;">👑✨ ¡Feliz Día de Reyes!</h2>
      <p style="margin:0 0 12px;">
        Hemos recibido un <strong>PDF</strong> enviado desde el buzón navideño de
        <strong>${displayName}</strong>.
      </p>

      <div style="padding:12px 14px; border:1px solid #e5e7eb; border-radius:12px; background:#fafafa; margin:0 0 12px;">
        <div style="font-size:14px; margin-bottom:6px;">📎 <strong>Archivo adjunto</strong></div>
        <div style="font-size:14px;">${fileName}</div>
      </div>

      <p style="margin:0 0 10px;">
        Que esta temporada esté llena de alegría, salud y buenos deseos.
      </p>
      <p style="margin:0; font-weight:bold;">✨ ¡Feliz Día de Reyes!</p>

      <hr style="margin:16px 0; border:none; border-top:1px solid #eee;">
    </div>
  `,
            attachments: [
                {
                    filename: fileName,
                    content: fileBuffer, // Buffer directo
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
