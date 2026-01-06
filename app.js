// Límite recomendado para evitar envíos pesados (ajústalo a tu necesidad)
const MAX_SIZE_MB = 10;

document.querySelectorAll(".mailbox").forEach((mailboxEl) => {
    const fileInput = mailboxEl.querySelector(".file-input");
    const sendBtn = mailboxEl.querySelector(".send-btn");
    const statusEl = mailboxEl.querySelector(".status");

    // Lee la configuración del buzón desde atributos data-*
    const mailboxName = mailboxEl.dataset.mailboxName;
    const toEmail = mailboxEl.dataset.toEmail;

    // Muestra el nombre del archivo seleccionado
    fileInput.addEventListener("change", () => {
        statusEl.textContent = fileInput.files?.[0]
            ? `Archivo seleccionado: ${fileInput.files[0].name}`
            : "";
    });

    sendBtn.addEventListener("click", async () => {
        const file = fileInput.files?.[0];

        // 1) Validación básica: exista archivo
        if (!file) {
            statusEl.textContent = "Por favor, selecciona un PDF antes de enviar.";
            return;
        }

        // 2) Validación: tipo PDF (MIME)
        if (file.type !== "application/pdf") {
            statusEl.textContent = "El archivo debe ser un PDF (application/pdf).";
            return;
        }

        // 3) Validación: tamaño máximo
        const sizeMb = file.size / (1024 * 1024);
        if (sizeMb > MAX_SIZE_MB) {
            statusEl.textContent = `El PDF pesa ${sizeMb.toFixed(2)} MB. Maximo permitido: ${MAX_SIZE_MB} MB.`;
            return;
        }

        // UI: bloquea botón mientras envía
        sendBtn.disabled = true;
        statusEl.textContent = `Enviando carta...`;

        try {
            // FormData permite mandar archivos usando multipart/form-data
            const formData = new FormData();
            formData.append("mailboxName", mailboxName);
            formData.append("pdf", file, file.name);

            // Este endpoint lo implementas en tu backend (Node, PHP, serverless, etc.)
            const resp = await fetch("/.netlify/functions/send-pdf", {
                method: "POST",
                body: formData,
            });

            // Si el backend responde con error HTTP, lo marcamos como fallo
            if (!resp.ok) {
                const text = await resp.text().catch(() => "");
                throw new Error(text || `Error HTTP ${resp.status}`);
            }

            statusEl.textContent = `¡Feliz Día de Reyes!`;
            fileInput.value = ""; // Limpia selección
        } catch (err) {
            statusEl.textContent =
                `❌ No se pudo enviar. ` +
                `Verifica que exista el endpoint /api/send-pdf. ` +
                `Detalle: ${err?.message || err}`;
        } finally {
            sendBtn.disabled = false;
        }
    });
});
