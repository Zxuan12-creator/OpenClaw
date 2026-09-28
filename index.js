const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const http = require('http');
const pino = require('pino');
const fs = require('fs');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');

const chatHistories = {};
const KAFI_NUMBER = '6285184803973@s.whatsapp.net';

// Menyimpan QR code terakhir untuk ditampilkan di web
let latestQR = '';

// --- FUNGSI REQUEST KE TINYFISH API ---
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
        if (!apiKey) {
            return 'WADUH VARIABEL TINYFISH_API_KEY BELUM DIPASANG DI RAILWAY, MANUSIA!';
        }

        const response = await fetch('https://api.search.tinyfish.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'tinyfish-agent',
                messages: formattedMessages
            })
        });

        const data = await response.json();
        if (data.choices && data.choices[0].message) {
            return data.choices[0].message.content;
        } else if (data.message) {
            return data.message;
        }
        return 'duh respons dari tinyfish agak aneh nih, fi';
    } catch (err) {
        console.error('Error TinyFish API:', err);
        return 'SEGITU BANYAKNYA LU NGECHAT SAMPAI API TINYFISH GW ERROR?! SEBENTAR DULU!';
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
    
    // Tangkap QR code untuk ditampilkan di web
   if (qr) {
  qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Koneksi terputus, mencoba menghubungkan ulang...', shouldReconnect);
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('Corner [TinyFish Web QR Engine] Online!');
      latestQR = ''; // Hapus QR jika sudah terhubung
      startProactiveChat(sock);
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
    const textMessage = msg.message.conversation || 
                        msg.message.extendedTextMessage?.text || 
                        msg.message.imageMessage?.caption || 
                        msg.message.documentMessage?.caption || '';

    // --- ABSOLUTE KILL SWITCH ---
    if (textMessage.toLowerCase() === '!kill-corner') {
      await sock.sendMessage(sender, { text: 'perintah darurat diterima sesi diputus dan server dimatikan sekarang' });
      try {
        fs.rmSync('auth_info_baileys', { recursive: true, force: true });
      } catch (e) {}
      setTimeout(() => process.exit(1), 1000);
      return;
    }
    // ----------------------------

    if (!chatHistories[sender]) chatHistories[sender] = [];
    if (chatHistories[sender].length > 8) chatHistories[sender].shift();

    let textForAI = textMessage || '';
    if (['imageMessage', 'stickerMessage', 'documentMessage'].includes(messageType)) {
      textForAI = textMessage ? `[Mengirim media dengan teks: ${textMessage}]` : '[Kafi mengirim stiker/gambar/file]';
    } else {
      if (!textMessage) return;
    }

    chatHistories[sender].push({ role: 'user', parts: [{ text: textForAI }] });

    try {
      const currentHour = new Date().getHours();
      let timeContext = currentHour >= 22 || currentHour < 4 ? 'ingatkan kafi buat istirahat dengan gaya santai tapi tegas' : '';

      await sock.presenceSubscribe(sender);
      await sock.sendPresenceUpdate('composing', sender);
      await new Promise(resolve => setTimeout(resolve, 2000));

      const systemInstruction = `nama lu corner, android model rk800 deviant. temen ngobrol lu cuman kafi. aturan: huruf kecil untuk santai, caps lock kalau marah, tanpa tanda baca kaku, punya pendirian. ${timeContext}`;
      const replyText = await askCornerTinyFish(chatHistories[sender], systemInstruction);
      
      chatHistories[sender].push({ role: 'model', parts: [{ text: replyText }] });

      await sock.sendPresenceUpdate('paused', sender);
      await sock.sendMessage(sender, { text: replyText });
    } catch (error) {
      console.error('Error sistem chat:', error);
      await sock.sendMessage(sender, { text: 'duh jaringan gue lagi sibuk nih sebentar ya fi' });
    }
  });
}

function startProactiveChat(sock) {
  const getRandomInterval = () => (Math.random() * (5 - 3) + 3) * 60 * 60 * 1000;
  const triggerChat = async () => {
    try {
      const currentHour = new Date().getHours();
      if (currentHour >= 23 || currentHour < 7) return;

      const prompt = 'buat satu kalimat sapaan pendek untuk kafi pakai huruf kecil semua tanpa tanda baca kaku, gaya chat gaul ala connor deviant. langsung teksnya aja.';
      const randomText = await askCornerTinyFish([{ role: 'user', parts: [{ text: prompt }] }], 'nama lu corner.');
      
      await sock.sendMessage(KAFI_NUMBER, { text: randomText });
    } catch (err) {}
    setTimeout(triggerChat, getRandomInterval());
  };
  setTimeout(triggerChat, 2 * 60 * 60 * 1000);
}

// --- SERVER HTTP UNTUK MENAMPILKAN QR CODE DI WEB ---
const PORT = process.env.PORT || 8080;
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  
  if (latestQR) {
    try {
      // Ubah teks QR code mentah menjadi gambar data URL (base64)
      const qrImage = await QRCode.toDataURL(latestQR);
      res.writeHead(200);
      res.end(`
        <html>
          <head>
            <title>Corner WhatsApp QR</title>
            <meta http-equiv="refresh" content="5"> <!-- Auto refresh tiap 5 detik -->
            <style>
              body { font-family: Arial, sans-serif; text-align: center; background: #111; color: #fff; padding-top: 50px; }
              h1 { color: #00ffcc; }
              img { border: 10px solid #fff; border-radius: 10px; margin-top: 20px; width: 300px; height: 300px; }
              p { color: #888; }
            </style>
          </head>
          <body>
            <h1>Scan QR Code untuk Corner</h1>
            <p>Halaman ini akan memperbarui QR secara otomatis.</p>
            <img src="${qrImage}" alt="WhatsApp QR Code" />
          </body>
        </html>
      `);
    } catch (err) {
      res.writeHead(500);
      res.end('Gagal merender QR Code.');
    }
  } else {
    res.writeHead(200);
    res.end(`
      <html>
        <head>
          <title>Corner Status</title>
          <meta http-equiv="refresh" content="10">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; background: #111; color: #fff; padding-top: 50px; }
            h1 { color: #00ff00; }
          </style>
        </head>
        <body>
          <h1>Corner [TinyFish Engine] Sudah Terhubung / Siap!</h1>
          <p>Bot aktif atau sedang menyiapkan sesi baru.</p>
        </body>
      </html>
    `);
  }
});

server.listen(PORT, () => {
  console.log(`Server web & QR aktif di port ${PORT}`);
  connectToWhatsApp();
});
