import Busboy from "busboy";
import sgMail from "@sendgrid/mail";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

function parseMultipart(req) {
    return new Promise((resolve, reject) => {
        const bb = Busboy({
            headers: req.headers,
            limits: { files: 1, fileSize: MAX_FILE_BYTES }
        });

        const fields = {};
        let fileBuffer = null;
        let fileName = null;
        let fileMime = null;

        bb.on("field", (name, val) => {
            fields[name] = val;
        });

        bb.on("file", (name, file, info) => {
            const { filename, mimeType } = info;

            fileName = filename;
            fileMime = mimeType;

            const chunks = [];
            file.on("data", (chunk) => chunks.push(chunk));

            file.on("limit", () => {
                reject(new Error("El archivo excede el tamaño permitido."));
            });

            file.on("end", () => {
                fileBuffer = Buffer.concat(chunks);
            });
        });

        bb.on("error", reject);

        bb.on("finish", () => {
            resolve({ fields, fileBuffer, fileName, fileMime });
        });

        req.pipe(bb);
    });
}

export default async function handler(req, res) {
    // 1) Método permitido
    if (req.method !== "POST") {
        return res.status(405).send("Method Not Allowed");
    }

    try {
        // 2) Parsear el multipart (mailboxName + pdf)
        const { fields, fileBuffer, fileName, fileMime } = await parseMultipart(req);

        // 3) Validaciones básicas
        const mailboxName = fields.mailboxName;

        if (!mailboxName) {
            return res.status(400).send("Falta mailboxName.");
        }

        if (!fileBuffer || !fileName) {
            return res.status(400).send("Falta el archivo PDF.");
        }

        if (fileMime !== "application/pdf") {
            return res.status(400).send("El archivo debe ser PDF (application/pdf).");
        }

        // 4) Destinatarios fijos (evita abuso: el cliente NO decide el correo)
        const recipients = {
            Gulugu: process.env.TO_GULUGU,
            Davidcito: process.env.TO_DAVIDCITO
        };

        const to = recipients[mailboxName];
        if (!to) {
            return res.status(400).send("Buzón no reconocido.");
        }

        // 5) Configurar SendGrid
        if (!process.env.SENDGRID_API_KEY || !process.env.FROM_EMAIL) {
            return res.status(500).send("Faltan variables de entorno del correo.");
        }

        sgMail.setApiKey(process.env.SENDGRID_API_KEY);

        // 6) Enviar correo con adjunto
        await sgMail.send({
            to,
            from: process.env.FROM_EMAIL,
            subject: `📬 Buzón ${mailboxName} - PDF recibido`,
            text: `Se recibió un PDF desde el buzón "${mailboxName}".`,
            attachments: [
                {
                    content: fileBuffer.toString("base64"),
                    filename: fileName,
                    type: "application/pdf",
                    disposition: "attachment"
                }
            ]
        });

        return res.status(200).json({ ok: true, message: "Enviado correctamente." });
    } catch (err) {
        return res.status(500).json({
            ok: false,
            error: err?.message || "Error inesperado"
        });
    }
}
