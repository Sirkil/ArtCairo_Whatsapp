const QRCode = require('qrcode');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const PHONE_NUMBER = "201020068368"; // Change this to the target number
const TOTAL_CODES = 100;
const FRAME_FILENAME = "QrCodeFrameA1.png"; // Must be in /assets folder
const OUTPUT_DIR = path.join(__dirname, 'generated_qrs');
const ASSETS_DIR = path.join(__dirname, 'assets');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
}

async function generateBulkQRs() {
    console.log(`🚀 Starting generation of ${TOTAL_CODES} QR codes...`);
    const framePath = path.join(ASSETS_DIR, FRAME_FILENAME);

    if (!fs.existsSync(framePath)) {
        console.error(`❌ Frame file missing at: ${framePath}`);
        return;
    }

    try {
        const frameMetadata = await sharp(framePath).metadata();

        for (let i = 1; i <= TOTAL_CODES; i++) {
            const qrData = `${PHONE_NUMBER}-${i}`;
            const fileName = `ticket_${qrData}.png`;
            const filePath = path.join(OUTPUT_DIR, fileName);

            // 1. Generate QR Code Buffer
            const qrBuffer = await QRCode.toBuffer(qrData, {
                width: 720,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                }
            });

            // 2. Composite QR onto Frame
            await sharp({
                create: {
                    width: frameMetadata.width,
                    height: frameMetadata.height,
                    channels: 4,
                    background: '#081540' // Matching your original background color
                }
            })
            .composite([
                { 
                    input: qrBuffer, 
                    top: 215, // Matching your original positioning
                    left: 180 
                },
                { 
                    input: framePath, 
                    top: 0, 
                    left: 0 
                }
            ])
            .toFile(filePath);

            console.log(`[${i}/${TOTAL_CODES}] Saved: ${fileName}`);
        }

        console.log(`\n✅ Done! All images are in: ${OUTPUT_DIR}`);
    } catch (err) {
        console.error("Critical error during processing:", err);
    }
}

generateBulkQRs();