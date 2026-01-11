const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const sharp = require("sharp");
const csv = require("csv-parse/sync");
require("dotenv").config();

const app = express();

// 🔗 Put your Google Apps Script Web App URL here
const GSHEET_WEBHOOK_URL = " ";

// Parse JSON and keep raw body (optional, for logging)
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // Serve static files from 'public' directory

// Serve the web interface
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ------------------------------
// 1) Webhook Verification (GET)
// ------------------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("✅ Webhook verified successfully");
    return res.status(200).send(challenge);
  }

  console.warn("❌ Webhook verification failed");
  return res.sendStatus(403);
});

// ------------------------------
// 2) Webhook Receiver (POST)
// ------------------------------
const messagesLog = [];

// Load and parse recipients.csv
const recipientsPath = path.join(__dirname, "recipients.csv");
let recipients = [];
try {
  const fileContent = fs.readFileSync(recipientsPath, "utf-8");
  recipients = csv.parse(fileContent, { columns: true, skip_empty_lines: true });
} catch (err) {
  console.error("❌ Error reading recipients.csv:", err.message);
}

app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Quick response to Meta

  const entry = req.body?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const message = value?.messages?.[0];
  const contact = value?.contacts?.[0];

  if (!message || !contact) return;

  const phone = contact.wa_id || "Unknown";
  const msgType = message.type;
  let userMessage = "";

  if (msgType === "text") {
    userMessage = message.text?.body;
  } else if (msgType === "button") {
    userMessage = message.button?.text;
  } else if (msgType === "interactive") {
    userMessage = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title;
  } else {
    userMessage = `[${msgType} message received]`;
  }

  // Find name from recipients.csv, default to "Guest" if not found
  const recipient = recipients.find(r => r.number === phone);
  const csvName = recipient ? recipient.first_name : "Guest";

  console.log(`📥 New Message from ${csvName} (${phone}): ${userMessage}`);

  let replyStatus = "Logged Only"; // Default status

  try {
    if (userMessage === "Attending") {
      const qrData = `T${phone}`;
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrData)}`;

      try {
        // 1. Download QR (200x200)
        const qrResponse = await axios.get(qrUrl, { responseType: "arraybuffer" });
        const qrBuffer = Buffer.from(qrResponse.data);

        // 2. Load your frame image (300x300 PNG)
        const framePath = path.join(__dirname, "assets", "frame.png");

        // 3. Composite QR centered on frame and add text
        const finalImageBuffer = await sharp(framePath)
          .composite([
            { input: qrBuffer, gravity: "center" },
            {
              input: Buffer.from(
                `<svg width="300" height="50" x="0" y="250">
                  <text x="50%" y="50%" dy="35" font-family="Arial" font-size="28" fill="black" text-anchor="middle">
                    ${csvName}
                  </text>
                </svg>`
              ),
              gravity: "south",
            },
          ])
          .png()
          .toBuffer();

        // 4. Save into public/ so it’s served on Render
        const fileName = `qr_${phone}_${Date.now()}.png`;
        const outputPath = path.join(__dirname, "public", fileName);
        fs.writeFileSync(outputPath, finalImageBuffer);

        // 5. Public URL (Render serves public/ at root)
        const finalImageUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/${fileName}?t=${Date.now()}`;

        // 6. Send on WhatsApp
        await sendWhatsAppMessage(phone, {
          type: "image",
          image: {
            link: finalImageUrl,
            caption: `Hello ${csvName}, Thank you for confirming your attendance to *talabat Egypt’s Annual Partners Event*.\n  \nPlease use this QR code at the entrance gate.\n  \n📅 5 Oct 2025\n📍 Grand Egyptian Museum\n⏰ 6:00 PM\nDress code: Business formal attire\n  \nPlease note that this is a non-transferable personal invite.`,
          },
        });

        replyStatus = "✅ QR Code with Frame and Name sent successfully";
      } catch (err) {
        console.error("❌ Error creating framed QR:", err.message);
      }
    } else if (userMessage === "Not Attending") {
      await sendWhatsAppMessage(phone, {
        type: "text",
        text: { body: "Thank you for letting us know. We will truly miss your presence." },
      });

      replyStatus = "✅ Thanks message sent successfully";
    } else {
      // No logical reply, logged to Google Sheets
      replyStatus = "ℹ️ No logical reply found";
    }

    // Always log/update Google Sheet
    await axios.post(GSHEET_WEBHOOK_URL, {
      name: csvName,
      number: phone,
      message: userMessage,
      replyStatus,
    });
    console.log(`✅ Sheet updated: ${replyStatus}`);
  } catch (err) {
    console.error("❌ Error sending message or updating sheet:", err.message);
  }

  // Also keep in-memory log
  messagesLog.push({ name: csvName, number: phone, message: userMessage, replyStatus });
});

// ------------------------------
// 3) Manual Reply API
// ------------------------------
app.post("/reply", async (req, res) => {
  const { number, replyMessage } = req.body;
  if (!number || !replyMessage) {
    return res.status(400).json({ success: false, error: "Missing number or replyMessage" });
  }

  try {
    await sendWhatsAppMessage(number, {
      type: "text",
      text: { body: replyMessage },
    });

    console.log(`✅ Manual reply sent to ${number}: ${replyMessage}`);
    messagesLog.push({ name: "Admin", number, message: replyMessage, replyStatus: "Manual Reply" });
    return res.json({ success: true, message: "Reply sent" });
  } catch (err) {
    console.error("❌ Error sending manual reply:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ------------------------------
// 4) Send WhatsApp Message
// ------------------------------
async function sendWhatsAppMessage(to, messageData) {
  await axios.post(
    `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      ...messageData,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ------------------------------
// 5) Get Messages API
// ------------------------------
app.get("/messages", (req, res) => {
  res.json(messagesLog.slice(-50)); // last 50 messages
});

// ------------------------------
// 6) Start Server
// ------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});