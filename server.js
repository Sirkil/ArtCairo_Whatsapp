const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const QRCode = require('qrcode');
const sharp = require('sharp'); 
require("dotenv").config();

const app = express();
app.use(express.json());
// Serve the public folder so WhatsApp can access the generated images
app.use(express.static('public')); 

const GSHEET_WEBHOOK_URL = process.env.GSHEET_WEBHOOK_URL;
const messagesLog = [];

// 1) Webhook Verification
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
      // Uses the first frame for the primary attendee
      await sendQrMessage(phone, phoneId, qrValue, "Thank you! Here is your QR code.", "Qr Code Frame.png");
      
      setTimeout(() => sendPlusOneButton(phone, phoneId), 2000);
      replyStatus = "Sent QR 1 + PlusOne Button";
    } 
    else if (userMessage === "+1") {
      const qrValue = `${phone}-2`;
      // Uses the second frame for the guest
      await sendQrMessage(phone, phoneId, qrValue, "Here is your guest QR code!", "Qr Code Frame.png");
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

// ------------------------------------------------
// 3) Helper: Generate, Layer (Background -> QR -> Frame)
// ------------------------------------------------
async function sendQrMessage(to, phoneId, qrData, caption, frameFileName) {
  const fileName = `ticket_${qrData}_${Date.now()}.png`;
  const filePath = path.join(__dirname, 'public', fileName);
  const framePath = path.join(__dirname, 'assets', frameFileName);
  
  try {
    // Get frame dimensions to ensure the background canvas matches perfectly
    const frameMetadata = await sharp(framePath).metadata();

    // 1. Generate QR Code Buffer
    const qrBuffer = await QRCode.toBuffer(qrData, {
      width: 650, // Size of the QR code
      margin: 1,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    // 2. Layering: Create #081540 background, add QR, then add Frame on top
    await sharp({
      create: {
        width: frameMetadata.width,
        height: frameMetadata.height,
        channels: 4,
        background: '#081540' // Set background to your requested color
      }
    })
    .composite([
      { 
        input: qrBuffer, 
        top: 250,  // Position the QR code
        left: 250 
      },
      { 
        input: framePath, // Frame is added LAST, making it the top layer
        top: 0, 
        left: 0 
      }
    ])
    .toFile(filePath);

    // 3. Send to WhatsApp
    const publicUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/${fileName}`;

    await axios.post(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      messaging_product: "whatsapp",
      to: to,
      type: "image",
      image: { link: publicUrl, caption: caption }
    }, { 
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } 
    });

    console.log(`Success: Sent framed QR (${frameFileName}) to ${to}`);
  } catch (err) {
    console.error("Error creating framed QR:", err);
  }
}

// 4) Helper: Send +1 Button
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

// Manual Admin Reply API
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

app.get("/messages", (req, res) => res.json(messagesLog.slice(-50)));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));