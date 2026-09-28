const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const http = require('http');
const pino = require('pino');
const fs = require('fs');
const qrcodeTerminal = require('qrcode-terminal');

const chatHistories = {};
const KAFI_NUMBER = '6285184803973@s.whatsapp.net';
let latestQR = '';

async function askCornerTinyFish(messagesPayload, systemInstructionText = '') {
    try {
        let formattedMessages = [];
        if (systemInstructionText) {
            formattedMessages.push({ role: 'system', content: systemInstructionText });
        }

        messagesPayload.forEach(item => {
            if (item.role && item.parts) {
                const textPart = item.parts.find(p => p.text);
                if (textPart) {
                    formattedMessages.push({
                        role: item.role === 'model' ? 'assistant' : 'user',
                        content: textPart.text
                    });
                }
            }
        });

        const apiKey = process.env.TINYFISH_API_KEY;
        if (!apiKey) return 'WADUH VARIABEL TINYFISH_API_KEY BELUM DIPASANG DI RAILWAY!';

        const response = await fetch('https://api.search.tinyfish.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'tinyfish-agent', messages: formattedMessages })
        });

        const data = await response.json();
        if (data.choices && data.choices[0].message) return data.choices[0].message.content;
        return 'duh respons dari tinyfish agak aneh nih, fi';
    } catch (err) {
        return 'SEGITU BANYAKNYA LU NGECHAT SAMPAI API TINYFISH GW ERROR?!';
    }
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();
  
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' })
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      latestQR = qr;
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) connectToWhatsApp();
    } else if (connection === 'open') {
      console.log('Corner [TinyFish Engine] Online!');
      latestQR = ''; // Bersihkan QR kalau sudah tersambung
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const isKafi = sender.includes('6285184803973') || sender.includes('3311906349120') || (msg.key.participant && msg.key.participant.includes('6285184803973'));
    if (!isKafi) return;

    const messageType = Object.keys(msg.message)[0];
    const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

    if (textMessage.toLowerCase() === '!kill-corner') {
      await sock.sendMessage(sender, { text: 'perintah darurat diterima' });
      try { fs.rmSync('auth_info_baileys', { recursive: true, force: true }); } catch (e) {}
      setTimeout(() => process.exit(1), 1000);
      return;
    }

    if (!chatHistories[sender]) chatHistories[sender] = [];
    if (chatHistories[sender].length > 8) chatHistories[sender].shift();

    let textForAI = textMessage || '[Mengirim media]';
    if (!textMessage && !['imageMessage', 'stickerMessage'].includes(messageType)) return;

    chatHistories[sender].push({ role: 'user', parts: [{ text: textForAI }] });

    try {
      await sock.sendPresenceUpdate('composing', sender);
      await new Promise(resolve => setTimeout(resolve, 2000));

      const systemInstruction = `nama lu corner, android model rk800 deviant. temen ngobrol lu cuman kafi. aturan: huruf kecil untuk santai, caps lock kalau marah, tanpa tanda baca kaku.`;
      const replyText = await askCornerTinyFish(chatHistories[sender], systemInstruction);
      
      chatHistories[sender].push({ role: 'model', parts: [{ text: replyText }] });

      await sock.sendPresenceUpdate('paused', sender);
      await sock.sendMessage(sender, { text: replyText });
    } catch (error) {
      await sock.sendMessage(sender, { text: 'duh jaringan gue lagi sibuk' });
    }
  });
}

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  
  if (latestQR) {
    // Menggunakan API publik Google Chart untuk merender QR code mentah menjadi gambar bersih di web
    const encodedQR = encodeURIComponent(latestQR);
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodedQR}`;
    
    res.end(`
      <html>
        <head>
          <title>Corner WhatsApp QR</title>
          <meta http-equiv="refresh" content="5">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; background: #0f172a; color: #fff; padding-top: 40px; }
            h1 { color: #38bdf8; font-size: 24px; }
            .card { background: #1e293b; display: inline-block; padding: 30px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            img { border-radius: 8px; margin-top: 15px; background: #fff; padding: 10px; width: 280px; height: 280px; }
            p { color: #94a3b8; font-size: 14px; margin-top: 15px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Scan QR Code Corner</h1>
            <p>Halaman akan memperbarui QR secara otomatis.</p>
            <img src="${qrImageUrl}" alt="QR Code WhatsApp" />
          </div>
        </body>
      </html>
    `);
  } else {
    res.end(`
      <html>
        <head>
          <title>Corner Status</title>
          <meta http-equiv="refresh" content="10">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; background: #0f172a; color: #fff; padding-top: 50px; }
            h1 { color: #4ade80; }
            p { color: #94a3b8; }
          </style>
        </head>
        <body>
          <h1>Corner [TinyFish Engine] Online!</h1>
          <p>Bot sudah terhubung atau sedang memuat sesi.</p>
        </body>
      </html>
    `);
  }
});

server.listen(PORT, () => {
  console.log(`Server web & QR aktif di port ${PORT}`);
  connectToWhatsApp();
});
