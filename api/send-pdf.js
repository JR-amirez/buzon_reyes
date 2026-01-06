import Busboy from "busboy";
import nodemailer from "nodemailer";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

function parseMultipart(req) {
    return new Promise((resolve, reject) => {
        const bb = Busboy({
            headers: req.headers,
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
            const { filename, mimeType } = info;

            fileName = filename;
            fileMime = mimeType;

            const chunks = [];
            file.on("data", (chunk) => chunks.push(chunk));

            file.on("limit", () => reject(new Error("El archivo excede el tamaño permitido.")));

            file.on("end", () => {
                fileBuffer = Buffer.concat(chunks);
            });
        });

        bb.on("error", reject);

        bb.on("finish", () => resolve({ fields, fileBuffer, fileName, fileMime }));

        req.pipe(bb);
    });
}

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    try {
        const { fields, fileBuffer, fileName, fileMime } = await parseMultipart(req);

        const mailboxName = fields.mailboxName;
        if (!mailboxName) return res.status(400).send("Falta mailboxName.");
        if (!fileBuffer || !fileName) return res.status(400).send("Falta el archivo PDF.");
        if (fileMime !== "application/pdf") return res.status(400).send("El archivo debe ser PDF.");

        // Destinos fijos por seguridad (no dependas del data-to-email del HTML)
        const recipients = {
            Gulugu: process.env.TO_GULUGU,
            Davidcito: process.env.TO_DAVIDCITO,
        };

        const to = recipients[mailboxName];
        if (!to) return res.status(400).send("Buzón no reconocido.");

        // Config SMTP (mínimo indispensable)
        const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
        if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
            return res.status(500).send("Faltan variables SMTP (HOST, PORT, USER, PASS).");
        }

        const transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: Number(SMTP_PORT),
            secure: Number(SMTP_PORT) === 465, // 465 = SSL, 587 = STARTTLS
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASS,
            },
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
                    content: fileBuffer,          // aquí va el Buffer tal cual (no base64)
                    contentType: "application/pdf",
                },
            ],
        });

        return res.status(200).json({ ok: true });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err?.message || "Error inesperado" });
    }
}
