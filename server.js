const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const QRCode = require('qrcode');
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.static('public')); // This is necessary for Render to serve the QR images

const GSHEET_WEBHOOK_URL = process.env.GSHEET_WEBHOOK_URL;
const messagesLog = [];

// ------------------------------
// 1) Webhook Verification
// ------------------------------
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === process.env.VERIFY_TOKEN) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

// ------------------------------
// 2) Webhook Receiver
// ------------------------------
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  const entry = req.body?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const message = value?.messages?.[0];
  const metadata = value?.metadata; // Dynamic phone_number_id from the incoming message

  if (!message) return;

  const phone = message.from;
  const phoneId = metadata.phone_number_id; 
  const userMessage = message.button?.text || message.interactive?.button_reply?.title || message.text?.body;

  let replyStatus = "Logged";

  try {
    // Logic Flow: Attending -> QR 1 -> +1 Button
    if (userMessage === "Attending") {
      const qrValue = `${phone}-1`;
      await sendQrMessage(phone, phoneId, qrValue, "Thank you! Here is your QR code.");
      
      // Wait a moment then send the +1 button
      setTimeout(() => sendPlusOneButton(phone, phoneId), 2000);
      replyStatus = "Sent QR 1 + PlusOne Button";
    } 
    
    // Logic Flow: +1 -> QR 2
    else if (userMessage === "+1") {
      const qrValue = `${phone}-2`;
      await sendQrMessage(phone, phoneId, qrValue, "Here is your guest QR code!");
      replyStatus = "Sent QR 2 (Guest)";
    }

    // Log to Google Sheets
    if (GSHEET_WEBHOOK_URL) {
      await axios.post(GSHEET_WEBHOOK_URL, {
        name: value.contacts?.[0]?.profile?.name || "Guest",
        number: phone,
        message: userMessage,
        replyStatus: replyStatus
      });
    }
  } catch (err) {
    console.error("Error in webhook logic:", err.message);
  }

  // Update memory log for index.html
  messagesLog.push({ 
    name: value.contacts?.[0]?.profile?.name || "Guest", 
    number: phone, 
    message: userMessage, 
    replyStatus 
  });
});

// ------------------------------
// 3) Helper: Generate & Send QR
// ------------------------------
async function sendQrMessage(to, phoneId, qrData, caption) {
  const fileName = `qr_${qrData}_${Date.now()}.png`;
  const filePath = path.join(__dirname, 'public', fileName);
  
  // Generate QR as a file in the public folder
  await QRCode.toFile(filePath, qrData, { width: 400 });

  // Public URL for WhatsApp to download the image
  const publicUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/${fileName}`;

  await axios.post(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    messaging_product: "whatsapp",
    to: to,
    type: "image",
    image: { link: publicUrl, caption: caption }
  }, { 
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } 
  });
}

// ------------------------------
// 4) Helper: Send +1 Button
// ------------------------------
async function sendPlusOneButton(to, phoneId) {
  await axios.post(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    messaging_product: "whatsapp",
    to: to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Would you like to register a guest (+1)?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "add_guest", title: "+1" } }
        ]
      }
    }
  }, { 
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } 
  });
}

app.get("/messages", (req, res) => res.json(messagesLog.slice(-50)));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));