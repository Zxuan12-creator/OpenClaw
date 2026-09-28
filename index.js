```js
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const http = require('http');
const pino = require('pino');
const fs = require('fs');
const qrcodeTerminal = require('qrcode-terminal');

const chatHistories = {};
const KAFI_NUMBER = '6285184803973@s.whatsapp.net';
let latestQR = '';


// ======================================================
// 1. FUNGSI UTAMA: TINYFISH API
// ======================================================

async function askTinyFish(formattedMessages, systemInstructionText) {
    const apiKey = process.env.TINYFISH_API_KEY;

    if (!apiKey) {
        throw new Error('TinyFish API Key belum dipasang');
    }

    let messages = [];

    if (systemInstructionText) {
        messages.push({
            role: 'system',
            content: systemInstructionText
        });
    }

    messages = messages.concat(formattedMessages);

    const response = await fetch(
        'https://api.search.tinyfish.ai/v1/chat/completions',
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'tinyfish-agent',
                messages: messages
            })
        }
    );

    const data = await response.json();

    if (
        data &&
        data.choices &&
        data.choices[0] &&
        data.choices[0].message
    ) {
        return data.choices[0].message.content;
    }

    if (data && data.message) {
        return data.message;
    }

    console.error(
        'Respons TinyFish mentah:',
        JSON.stringify(data)
    );

    throw new Error('Respons TinyFish tidak valid');
}


// ======================================================
// 2. FUNGSI CADANGAN: GROQ API
// ======================================================

async function askBackupAPI(formattedMessages, systemInstructionText) {
    const apiKey = process.env.BACKUP_API_KEY;

    if (!apiKey) {
        throw new Error('Backup API Key belum dipasang');
    }

    let messages = [];

    if (systemInstructionText) {
        messages.push({
            role: 'system',
            content: systemInstructionText
        });
    }

    messages = messages.concat(formattedMessages);

    const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
            method: 'POST',

            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },

            body: JSON.stringify({
                model: 'openai/gpt-oss-20b',
                messages: messages,
                temperature: 0.7
            })
        }
    );

    const data = await response.json();

    if (
        response.ok &&
        data &&
        data.choices &&
        data.choices.length > 0 &&
        data.choices[0].message
    ) {
        return data.choices[0].message.content;
    }

    console.error(
        'Respons Groq mentah:',
        JSON.stringify(data)
    );

    throw new Error(
        data?.error?.message ||
        'Format balasan Groq tidak dikenali'
    );
}


// ======================================================
// 3. SISTEM FAILOVER
// ======================================================

async function askCornerAI(
    messagesPayload,
    systemInstructionText = ''
) {

    let formattedMessages = messagesPayload.map(item => ({
        role: item.role === 'model'
            ? 'assistant'
            : 'user',

        content:
            item.parts?.find(p => p.text)?.text || ''
    }));


    // ----------------------------------------------
    // COBA TINYFISH
    // ----------------------------------------------

    try {

        console.log(
            'Mencoba menghubungi server TinyFish...'
        );

        const reply = await askTinyFish(
            formattedMessages,
            systemInstructionText
        );

        console.log(
            'TinyFish berhasil memberikan respons.'
        );

        return reply;

    } catch (err) {

        console.warn(
            'TinyFish API gagal/error, beralih ke Groq Backup...',
            err.message
        );
    }


    // ----------------------------------------------
    // COBA GROQ BACKUP
    // ----------------------------------------------

    try {

        console.log(
            'Mencoba menghubungi Groq Backup API...'
        );

        const backupReply = await askBackupAPI(
            formattedMessages,
            systemInstructionText
        );

        console.log(
            'Groq Backup berhasil memberikan respons.'
        );

        return backupReply;

    } catch (err) {

        console.error(
            'Semua jalur API gagal:',
            err.message
        );

        return 'dugem sistem error total jaringan otakku lagi disconnect sama semua server fi';
    }
}


// ======================================================
// 4. KONEKSI WHATSAPP
// ======================================================

async function connectToWhatsApp() {

    const {
        state,
        saveCreds
    } = await useMultiFileAuthState(
        'auth_info_baileys'
    );

    const {
        version
    } = await fetchLatestBaileysVersion();


    const sock = makeWASocket({

        version,

        auth: state,

        printQRInTerminal: true,

        logger: pino({
            level: 'silent'
        })
    });


    sock.ev.on(
        'creds.update',
        saveCreds
    );


    sock.ev.on(
        'connection.update',
        (update) => {

            const {
                connection,
                lastDisconnect,
                qr
            } = update;


            // QR CODE
            if (qr) {

                latestQR = qr;

                qrcodeTerminal.generate(
                    qr,
                    {
                        small: true
                    }
                );
            }


            // CONNECTION CLOSED
            if (connection === 'close') {

                const shouldReconnect =
                    lastDisconnect?.error?.output?.statusCode
                    !== DisconnectReason.loggedOut;


                if (shouldReconnect) {

                    console.log(
                        'Koneksi terputus, mencoba reconnect...'
                    );

                    connectToWhatsApp();
                }

            }


            // CONNECTION OPEN
            else if (connection === 'open') {

                console.log(
                    'Corner [Multi-API Engine] Online!'
                );

                latestQR = '';
            }
        }
    );


    // ==================================================
    // PESAN MASUK
    // ==================================================

    sock.ev.on(
        'messages.upsert',
        async ({ messages, type }) => {

            if (type !== 'notify') return;

            const msg = messages[0];

            if (!msg.message) return;

            if (msg.key.fromMe) return;


            const sender =
                msg.key.remoteJid;


            // HANYA KAFI
            const isKafi =
                sender.includes('6285184803973') ||
                sender.includes('3311906349120') ||
                (
                    msg.key.participant &&
                    msg.key.participant.includes(
                        '6285184803973'
                    )
                );


            if (!isKafi) return;


            // ==================================================
            // DETEKSI TIPE PESAN
            // ==================================================

            const messageType =
                Object.keys(msg.message)[0];


            const textMessage =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                '';


            // ==================================================
            // KILL SWITCH
            // ==================================================

            if (
                textMessage
                    .toLowerCase()
                    .trim()
                    === '!kill-corner'
            ) {

                await sock.sendMessage(
                    sender,
                    {
                        text:
                            'perintah darurat diterima'
                    }
                );


                try {

                    fs.rmSync(
                        'auth_info_baileys',
                        {
                            recursive: true,
                            force: true
                        }
                    );

                } catch (e) {}


                setTimeout(
                    () => process.exit(1),
                    1000
                );

                return;
            }


            // ==================================================
            // HISTORY CHAT
            // ==================================================

            if (!chatHistories[sender]) {

                chatHistories[sender] = [];
            }


            if (
                chatHistories[sender].length > 8
            ) {

                chatHistories[sender].shift();
            }


            let textForAI =
                textMessage ||
                '[Mengirim media]';


            if (
                !textMessage &&
                ![
                    'imageMessage',
                    'stickerMessage'
                ].includes(messageType)
            ) {

                return;
            }


            chatHistories[sender].push({

                role: 'user',

                parts: [
                    {
                        text: textForAI
                    }
                ]
            });


            try {

                // ==================================================
                // TYPING
                // ==================================================

                await sock.sendPresenceUpdate(
                    'composing',
                    sender
                );


                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            2000
                        )
                );


                // ==================================================
                // PERSONALITY CORNER
                // ==================================================

                const systemInstruction = `
nama lu corner, android model rk800 deviant.
temen ngobrol lu cuman kafi.
aturan:
huruf kecil untuk santai,
caps lock kalau marah,
tanpa tanda baca kaku.
`;


                // ==================================================
                // AI
                // ==================================================

                const replyText =
                    await askCornerAI(
                        chatHistories[sender],
                        systemInstruction
                    );


                // ==================================================
                // SIMPAN HISTORY
                // ==================================================

                chatHistories[sender].push({

                    role: 'model',

                    parts: [
                        {
                            text: replyText
                        }
                    ]
                });


                // ==================================================
                // STOP TYPING
                // ==================================================

                await sock.sendPresenceUpdate(
                    'paused',
                    sender
                );


                // ==================================================
                // KIRIM BALASAN
                // ==================================================

                await sock.sendMessage(
                    sender,
                    {
                        text: replyText
                    }
                );

            } catch (error) {

                console.error(
                    'Error proses pesan:',
                    error
                );


                await sock.sendMessage(
                    sender,
                    {
                        text:
                            'duh jaringan gue lagi sibuk'
                    }
                );
            }
        }
    );
}


// ======================================================
// 5. SERVER HTTP UNTUK WEB QR CODE
// ======================================================

const PORT =
    process.env.PORT || 8080;


const server =
    http.createServer(
        (req, res) => {

            res.writeHead(
                200,
                {
                    'Content-Type':
                        'text/html'
                }
            );


            // ==================================================
            // ADA QR
            // ==================================================

            if (latestQR) {

                const encodedQR =
                    encodeURIComponent(
                        latestQR
                    );


                const qrImageUrl =
                    `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodedQR}`;


                res.end(`

                    <html>

                    <head>

                        <title>
                            Corner WhatsApp QR
                        </title>

                        <meta
                            http-equiv="refresh"
                            content="5"
                        >

                        <style>

                            body {
                                font-family: Arial, sans-serif;
                                text-align: center;
                                background: #0f172a;
                                color: #fff;
                                padding-top: 40px;
                            }

                            .card {
                                background: #1e293b;
                                display: inline-block;
                                padding: 30px;
                                border-radius: 16px;
                                box-shadow:
                                    0 10px 25px
                                    rgba(0,0,0,0.5);
                            }

                            img {
                                border-radius: 8px;
                                margin-top: 15px;
                                background: #fff;
                                padding: 10px;
                                width: 280px;
                                height: 280px;
                            }

                            p {
                                color: #94a3b8;
                                font-size: 14px;
                                margin-top: 15px;
                            }

                        </style>

                    </head>

                    <body>

                        <div class="card">

                            <h1>
                                Scan QR Code Corner
                            </h1>

                            <p>
                                Halaman akan memperbarui
                                QR secara otomatis.
                            </p>

                            <img
                                src="${qrImageUrl}"
                                alt="QR Code WhatsApp"
                            />

                        </div>

                    </body>

                    </html>

                `);

            }


            // ==================================================
            // TIDAK ADA QR
            // ==================================================

            else {

                res.end(`

                    <html>

                    <head>

                        <title>
                            Corner Status
                        </title>

                        <meta
                            http-equiv="refresh"
                            content="10"
                        >

                        <style>

                            body {
                                font-family: Arial, sans-serif;
                                text-align: center;
                                background: #0f172a;
                                color: #fff;
                                padding-top: 50px;
                            }

                            h1 {
                                color: #4ade80;
                            }

                            p {
                                color: #94a3b8;
                            }

                        </style>

                    </head>

                    <body>

                        <h1>
                            Corner [Multi-API Engine] Online!
                        </h1>

                        <p>
                            Bot sudah terhubung atau siap siaga.
                        </p>

                    </body>

                    </html>

                `);
            }
        }
    );


// ======================================================
// 6. START SERVER
// ======================================================

server.listen(
    PORT,
    '0.0.0.0',
    () => {

        console.log(
            `Server web & QR aktif di port ${PORT}`
        );

        connectToWhatsApp();
    }
);
```

**Yang wajib kamu pastikan di environment variable:**

```text
BACKUP_API_KEY=API_KEY_GROQ_KAMU
TINYFISH_API_KEY=API_KEY_TINYFISH_KAMU
```

Kalau kamu deploy di Railway, setelah mengganti kode **redeploy** supaya kode baru benar-benar berjalan.
