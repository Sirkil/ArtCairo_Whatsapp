const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const QRCode = require('qrcode');
const sharp = require('sharp'); 
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.static('public')); 

const GSHEET_WEBHOOK_URL = process.env.GSHEET_WEBHOOK_URL;
// This array holds the chat history in memory
const messagesLog = [];

app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === process.env.VERIFY_TOKEN) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

// Route for the frontend to fetch the history
app.get("/messages", (req, res) => {
  res.json(messagesLog);
});

// Route for manual replies from the admin panel
app.post("/reply", async (req, res) => {
  const { number, replyMessage } = req.body;
  const phoneId = process.env.PHONE_NUMBER_ID; // Ensure this is in your .env

  try {
    await sendTextMessage(number, phoneId, replyMessage);
    
    // Log the sent message
    messagesLog.push({
      name: "Admin",
      number: number,
      message: replyMessage,
      replyStatus: "sent",
      timestamp: Date.now()
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  const entry = req.body?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const message = value?.messages?.[0];

  if (!message) return;

  const phone = message.from;
  const phoneId = value?.metadata?.phone_number_id; 
  const userMessage = message.button?.text || message.interactive?.button_reply?.title || message.text?.body;
  const userName = value.contacts?.[0]?.profile?.name || "Guest";

  // 1. Log the incoming message IMMEDIATELY
  messagesLog.push({ 
    name: userName, 
    number: phone, 
    message: userMessage, 
    replyStatus: "received", 
    timestamp: Date.now()
  });

  let replyStatus = "Logged";

  try {
    if (userMessage === "Attending") {
      const qrValue = `${phone}-1`;
      await sendQrMessage(phone, phoneId, qrValue, "We are pleased to confirm your attendance...", "QrCodeFrameA1.png");
      
      setTimeout(() => sendPlusOneButton(phone, phoneId), 3000);
      replyStatus = "Sent QR 1 + PlusOne Button";
    } 
    else if (userMessage === "Invite a Guest") {
      const qrValue = `${phone}-2`;
      await sendQrMessage(phone, phoneId, qrValue, "Here is the QR code for your guest...", "QrCodeFrameA2.png");
      replyStatus = "Sent QR 2 (Guest)";
    }
    else if (userMessage === "Not Attending") {
      await sendTextMessage(phone, phoneId, "Thank you for informing us.");
      replyStatus = "Sent Decline Message";
    }

    // Log the automated reply in the internal log
    messagesLog.push({
        name: "System",
        number: phone,
        message: replyStatus,
        replyStatus: "sent",
        timestamp: Date.now()
    });

    if (GSHEET_WEBHOOK_URL) {
      await axios.post(GSHEET_WEBHOOK_URL, {
        name: userName,
        number: phone,
        message: userMessage,
        replyStatus: replyStatus,
        phoneId: phoneId
      });
    }
  } catch (err) {
    console.error("WEBHOOK ERROR:", err.message);
  }
});

async function sendQrMessage(to, phoneId, qrData, caption, frameFileName) {
  const fileName = `ticket_${qrData}_${Date.now()}.png`;
  const filePath = path.join(__dirname, 'public', fileName);
  const framePath = path.join(__dirname, 'assets', frameFileName);
  
  try {
    // Check if frame exists to prevent crashes
    if (!fs.existsSync(framePath)) {
        console.error(`Frame file missing at: ${framePath}`);
        return;
    }

    const frameMetadata = await sharp(framePath).metadata();

    // 1. Generate QR Code Buffer
    // Reduced to 600 to give a small safety margin inside the white area
    const qrBuffer = await QRCode.toBuffer(qrData, {
      width: 720, 
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    // 2. Layering
    await sharp({
      create: {
        width: frameMetadata.width,
        height: frameMetadata.height,
        channels: 4,
        background: '#081540' 
      }
    })
    .composite([
      { 
        input: qrBuffer, 
        top: 215,  // Adjusted slightly to center in your specific frame
        left: 180 
      },
      { 
        input: framePath, 
        top: 0, 
        left: 0 
      }
    ])
    .toFile(filePath);

    const publicUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/${fileName}`;

    await axios.post(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      messaging_product: "whatsapp",
      to: to,
      type: "image",
      image: { link: publicUrl, caption: caption }
    }, { 
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } 
    });

    console.log(`Successfully sent framed QR to ${to}`);
  } catch (err) {
    console.error("IMAGE PROCESSING ERROR:", err);
  }
}

async function sendTextMessage(to, phoneId, text) {
  try {
    await axios.post(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: text }
    }, { 
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } 
    });
    console.log(`Text message sent to ${to}`);
  } catch (err) {
    console.error("TEXT MESSAGE ERROR:", err.response?.data || err.message);
  }
}

async function sendPlusOneButton(to, phoneId) {
  try {
      await axios.post(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        messaging_product: "whatsapp",
        to: to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: "Would you like to extend your invitation to *one accompanying guest*?" },
          action: {
            buttons: [{ type: "reply", reply: { id: "add_guest", title: "Invite a Guest" } }]
          }
        }
      }, { 
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } 
      });
  } catch (err) {
      console.error("PLUS ONE BUTTON ERROR:", err.response?.data || err.message);
  }
}

// Rest of your Admin API and Server Listen...
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));