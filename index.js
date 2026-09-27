const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenAI } = require('@google/genai');
const http = require('http');
const pino = require('pino');

// Inisialisasi Gemini API menggunakan key dari Environment Variables Railway
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Penyimpanan riwayat chat sementara per pengguna agar hemat token & tetap seperti manusia
const chatHistories = {};

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' })
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('SCAN QR CODE INI DI WHATSAPP KAMU (Cek Log Railway jika berbentuk teks):', qr);
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Koneksi terputus, mencoba menghubungkan ulang...', shouldReconnect);
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('Bot WhatsApp berhasil terhubung!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;
    if (!textMessage) return;

    console.log(`Pesan dari ${sender}: ${textMessage}`);

    // Inisialisasi riwayat chat jika belum ada untuk pengguna ini
    if (!chatHistories[sender]) {
      chatHistories[sender] = [];
    }

    // Batasi memori hanya 6 pesan terakhir agar hemat token tapi tetap nyambung seperti manusia
    if (chatHistories[sender].length > 6) {
      chatHistories[sender].shift();
    }

    chatHistories[sender].push({ role: 'user', parts: [{ text: textMessage }] });

    try {
      // Menggunakan model Gemini Flash untuk respons cepat, hemat, dan natural
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: chatHistories[sender],
        config: {
          systemInstruction: 'Kamu adalah teman ngobrol yang ramah, santai, menjawab dengan natural seperti manusia, tidak kaku, dan langsung pada intinya.'
        }
      });

      const replyText = response.text || 'Hmm, aku kurang paham maksudnya.';
      
      // Simpan balasan bot ke riwayat
      chatHistories[sender].push({ role: 'model', parts: [{ text: replyText }] });

      // Kirim balasan kembali ke WhatsApp
      await sock.sendMessage(sender, { text: replyText });
    } catch (error) {
      console.error('Error memanggil Gemini AI:', error);
      await sock.sendMessage(sender, { text: 'Duh, sebentar ya otaknya lagi ngadat nih.' });
    }
  });
}

// HTTP Server agar Railway mendeteksi aplikasi berjalan di port 8080
const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OpenClaw WhatsApp Bot is running 24/7 with Gemini AI!');
});

server.listen(PORT, () => {
  console.log(`Server web aktif di port ${PORT}`);
  connectToWhatsApp();
});
