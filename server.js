const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const QRCode = require('qrcode');
const sharp = require('sharp'); // New library for image layering
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const GSHEET_WEBHOOK_URL = process.env.GSHEET_WEBHOOK_URL;
const messagesLog = [];

// 1) Webhook Verification (Unchanged)
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === process.env.VERIFY_TOKEN) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

// 2) Webhook Receiver
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  const entry = req.body?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const message = value?.messages?.[0];
  const metadata = value?.metadata;

  if (!message) return;

  const phone = message.from;
  const phoneId = metadata.phone_number_id; 
  const userMessage = message.button?.text || message.interactive?.button_reply?.title || message.text?.body;

  let replyStatus = "Logged";

  try {
    if (userMessage === "Attending") {
      const qrValue = `${phone}-1`;
      // Pass 'QrCodeFrameA1.png' for the first user
      await sendQrMessage(phone, phoneId, qrValue, "Thank you! Here is your QR code.", "QrCodeFrameA1.png");
      
      setTimeout(() => sendPlusOneButton(phone, phoneId), 2000);
      replyStatus = "Sent QR 1 + PlusOne Button";
    } 
    else if (userMessage === "+1") {
      const qrValue = `${phone}-2`;
      // Pass 'QrCodeFrameA2.png' for the guest
      await sendQrMessage(phone, phoneId, qrValue, "Here is your guest QR code!", "QrCodeFrameA2.png");
      replyStatus = "Sent QR 2 (Guest)";
    }

    if (GSHEET_WEBHOOK_URL) {
      await axios.post(GSHEET_WEBHOOK_URL, {
        name: value.contacts?.[0]?.profile?.name || "Guest",
        number: phone,
        message: userMessage,
        replyStatus: replyStatus,
        phoneId: phoneId
      });
    }
  } catch (err) {
    console.error("Error in webhook logic:", err.message);
  }

  messagesLog.push({ 
    name: value.contacts?.[0]?.profile?.name || "Guest", 
    number: phone, 
    message: userMessage, 
    replyStatus 
  });
});

// ------------------------------
// 3) Helper: Generate, Layer & Send QR
// ------------------------------
async function sendQrMessage(to, phoneId, qrData, caption, frameFileName) {
  const fileName = `ticket_${qrData}_${Date.now()}.png`;
  const filePath = path.join(__dirname, 'public', fileName);
  const framePath = path.join(__dirname, 'assets', frameFileName);
  
  try {
    // 1. Generate QR Code as a Buffer (not a file yet)
    // We make it slightly smaller than the frame to fit in the white area
    const qrBuffer = await QRCode.toBuffer(qrData, {
      width: 220, // Adjust this size to fit your frame's white box
      margin: 1,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    // 2. Use Sharp to put the QR code on top of the frame
    // We assume the frame is roughly 300x300 or 400x400
    await sharp(framePath)
      .composite([{ 
        input: qrBuffer, 
        top: 45,  // Adjust these coordinates to center the QR in your frame
        left: 40 
      }])
      .toFile(filePath);

    // 3. Send via WhatsApp
    const publicUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/${fileName}`;

    await axios.post(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      messaging_product: "whatsapp",
      to: to,
      type: "image",
      image: { link: publicUrl, caption: caption }
    }, { 
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } 
    });

    console.log(`Success: Sent framed QR ${frameFileName} to ${to}`);
  } catch (err) {
    console.error("Error creating framed QR:", err);
  }
}

// 4) Helper: Send +1 Button (Unchanged)
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

// Admin API
app.get("/messages", (req, res) => res.json(messagesLog.slice(-50)));

// Send Manual Reply
app.post("/reply", async (req, res) => {
    const { number, replyMessage } = req.body;
    const phoneId = process.env.PHONE_NUMBER_ID; 
    const token = process.env.WHATSAPP_TOKEN;
  
    if (!phoneId || !token) return res.status(500).json({ success: false });
  
    try {
      await axios.post(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: number,
          type: "text",
          text: { body: replyMessage }
        }, { headers: { Authorization: `Bearer ${token}` } }
      );
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));