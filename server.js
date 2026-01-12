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
const messagesLog = [];

app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === process.env.VERIFY_TOKEN) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

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
      // Ensure your file in assets is named exactly QrCodeFrameA1.png or change this string
      await sendQrMessage(phone, phoneId, qrValue, "Thank you! Here is your QR code.", "QrCodeFrameA1.png");
      
      // Delaying the +1 button to ensure it arrives after the image
      setTimeout(() => sendPlusOneButton(phone, phoneId), 3000);
      replyStatus = "Sent QR 1 + PlusOne Button";
    } 
    else if (userMessage === "+1") {
      const qrValue = `${phone}-2`;
      await sendQrMessage(phone, phoneId, qrValue, "Here is your guest QR code!", "QrCodeFrameA1.png");
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
    console.error("WEBHOOK ERROR:", err.message);
  }

  messagesLog.push({ 
    name: value.contacts?.[0]?.profile?.name || "Guest", 
    number: phone, 
    message: userMessage, 
    replyStatus 
  });
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
      width: 650, 
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
        top: 250,  // Adjusted slightly to center in your specific frame
        left: 250 
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

async function sendPlusOneButton(to, phoneId) {
  try {
      await axios.post(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        messaging_product: "whatsapp",
        to: to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: "Would you like to register a guest (+1)?" },
          action: {
            buttons: [{ type: "reply", reply: { id: "add_guest", title: "+1" } }]
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