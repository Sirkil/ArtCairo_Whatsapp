/// VIP Invetiation
async function sendWhatsAppTemplate(to) {
  const videoUrl = "https://art-cairo-2.onrender.com/vip.mp4";

  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: to,
          type: "template",
          template: {
            // 1. Change name to match your template in Meta Dashboard
            name: "vip_inv2", 
            language: { code: "en" },
            components: [
              {
                type: "header",
                parameters: [
                  {
                    type: "video",
                    video: { link: videoUrl },
                  },
                ],
              },
              // 2. Body parameters (if your template uses variables like {{1}})
              // If your template text is static, you can omit the 'body' component
              {
                type: "body",
                parameters: [
                  // { type: "text", text: "Recipient Name" } // Example if needed
                ],
              },
              // 3. Quick Reply Buttons
              {
                type: "button",
                sub_type: "quick_reply",
                index: "0", // First button: "Attending"
                parameters: [{ type: "payload", payload: "CONFIRM_ATTEND" }],
              },
              {
                type: "button",
                sub_type: "quick_reply",
                index: "1", // Second button: "Not Attending"
                parameters: [{ type: "payload", payload: "DECLINE_ATTEND" }],
              },
            ],
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "Failed to send");
    }

    console.log(`✅ Template 'vip_inv2' sent to ${to}`);
    return { success: true, details: data };
  } catch (error) {
    console.error(`❌ Failed to send to ${to}:`, error.message);
    return { success: false, details: error.message };
  }
}
///Save the date Template
// async function sendWhatsAppTemplate(to) {
//   const videoUrl = "https://art-cairo-2.onrender.com/vtm1.mp4";

//   try {
//     const response = await fetch(
//       `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
//       {
//         method: "POST",
//         headers: {
//           Authorization: `Bearer ${WHATSAPP_TOKEN}`,
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify({
//           messaging_product: "whatsapp",
//           to: to,
//           type: "template",
//           template: { name: "video_template", language: { code: "en" }, components: [ { type: "header", parameters: [ { type: "video", video: { link: videoUrl }, }, ], }, ], },
//         }),
//       }
//     );

//     const data = await response.json();
    
//     if (!response.ok) {
//       throw new Error(data.error?.message || "Failed to send");
//     }

//     console.log(`✅ Video template sent to ${to}`);
//     return { success: true, details: data };
//   } catch (error) {
//     console.error(`❌ Failed to send to ${to}:`, error.message);
//     return { success: false, details: error.message };
//   }
// }