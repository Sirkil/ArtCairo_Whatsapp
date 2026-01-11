async function sendWhatsAppTemplate(to) {
  const videoUrl = "https://art-cairo-2.onrender.com/vtm1.mp4";

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
          template: { name: "video_template", language: { code: "en" }, components: [ { type: "header", parameters: [ { type: "video", video: { link: videoUrl }, }, ], }, ], },
        }),
      }
    );

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || "Failed to send");
    }

    console.log(`✅ Video template sent to ${to}`);
    return { success: true, details: data };
  } catch (error) {
    console.error(`❌ Failed to send to ${to}:`, error.message);
    return { success: false, details: error.message };
  }
}