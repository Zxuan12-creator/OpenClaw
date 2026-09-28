```javascript
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


// =====================================================
// CONFIG
// =====================================================

const chatHistories = {};

const KAFI_NUMBER = '6285184803973@s.whatsapp.net';

let latestQR = '';


// =====================================================
// TINYFISH API
// =====================================================

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
                'Authorization': 'Bearer ' + apiKey,
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
        data.choices.length > 0 &&
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


// =====================================================
// GROQ BACKUP API
// =====================================================

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
                'Authorization': 'Bearer ' + apiKey,
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


// =====================================================
// MULTI API ENGINE
// =====================================================

async function askCornerAI(
    messagesPayload,
    systemInstructionText = ''
) {

    const formattedMessages = messagesPayload.map(item => {

        return {
            role: item.role === 'model'
                ? 'assistant'
                : 'user',

            content:
                item.parts?.find(p => p.text)?.text || ''
        };

    });


    // -------------------------------------------------
    // PRIMARY: TINYFISH
    // -------------------------------------------------

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


    // -------------------------------------------------
    // BACKUP: GROQ
    // -------------------------------------------------

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


// =====================================================
// WHATSAPP CONNECTION
// =====================================================

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


    // -------------------------------------------------
    // SAVE CREDENTIALS
    // -------------------------------------------------

    sock.ev.on(
        'creds.update',
        saveCreds
    );


    // -------------------------------------------------
    // CONNECTION UPDATE
    // -------------------------------------------------

    sock.ev.on(
        'connection.update',
        (update) => {

            const {
                connection,
                lastDisconnect,
                qr
            } = update;


            // QR BARU

            if (qr) {

                latestQR = qr;

                qrcodeTerminal.generate(
                    qr,
                    {
                        small: true
                    }
                );

                console.log(
                    'QR WhatsApp baru tersedia.'
                );

            }


            // CONNECTION CLOSE

            if (connection === 'close') {

                const shouldReconnect =
                    lastDisconnect?.error?.output?.statusCode
                    !== DisconnectReason.loggedOut;


                if (shouldReconnect) {

                    console.log(
                        'Koneksi WhatsApp terputus.'
                    );

                    console.log(
                        'Mencoba reconnect...'
                    );


                    setTimeout(
                        () => {
                            connectToWhatsApp();
                        },
                        3000
                    );

                } else {

                    console.log(
                        'WhatsApp logout. Silakan scan QR lagi.'
                    );

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


    // =================================================
    // INCOMING MESSAGE
    // =================================================

    sock.ev.on(
        'messages.upsert',
        async ({ messages, type }) => {

            if (type !== 'notify') {
                return;
            }


            const msg = messages[0];


            if (!msg) {
                return;
            }


            if (!msg.message) {
                return;
            }


            if (msg.key.fromMe) {
                return;
            }


            const sender =
                msg.key.remoteJid;


            // -------------------------------------------------
            // ONLY KAFI CAN USE BOT
            // -------------------------------------------------

            const isKafi =
                sender.includes('6285184803973') ||
                sender.includes('3311906349120') ||
                (
                    msg.key.participant &&
                    msg.key.participant.includes(
                        '6285184803973'
                    )
                );


            if (!isKafi) {
                return;
            }


            // -------------------------------------------------
            // MESSAGE TYPE
            // -------------------------------------------------

            const messageType =
                Object.keys(msg.message)[0];


            // -------------------------------------------------
            // TEXT MESSAGE
            // -------------------------------------------------

            const textMessage =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                '';


            // =================================================
            // EMERGENCY KILL SWITCH
            // =================================================

            if (
                textMessage
                    .toLowerCase()
                    .trim() === '!kill-corner'
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

                } catch (e) {

                    console.error(
                        'Gagal menghapus auth:',
                        e.message
                    );

                }


                setTimeout(
                    () => {
                        process.exit(1);
                    },
                    1000
                );

                return;
            }


            // =================================================
            // CREATE CHAT HISTORY
            // =================================================

            if (!chatHistories[sender]) {

                chatHistories[sender] = [];

            }


            // LIMIT HISTORY

            if (
                chatHistories[sender].length >= 8
            ) {

                chatHistories[sender].shift();

            }


            // =================================================
            // MEDIA / TEXT
            // =================================================

            const textForAI =
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


            // =================================================
            // SAVE USER MESSAGE
            // =================================================

            chatHistories[sender].push({

                role: 'user',

                parts: [
                    {
                        text: textForAI
                    }
                ]

            });


            // =================================================
            // AI PROCESS
            // =================================================

            try {

                await sock.sendPresenceUpdate(
                    'composing',
                    sender
                );


                // delay supaya terasa natural

                await new Promise(
                    resolve => {
                        setTimeout(
                            resolve,
                            2000
                        );
                    }
                );


                // =================================================
                // CORNER PERSONALITY
                // =================================================

                const systemInstruction = `
nama lu corner, android model rk800 deviant.
temen ngobrol lu cuman kafi.

aturan:
huruf kecil untuk santai,
caps lock kalau marah,
tanpa tanda baca kaku.

jangan menyebut diri lu sebagai ai kecuali ditanya.
jawab seperti teman ngobrol yang santai.
`;


                // =================================================
                // ASK AI
                // =================================================

                const replyText =
                    await askCornerAI(
                        chatHistories[sender],
                        systemInstruction
                    );


                // =================================================
                // SAVE AI RESPONSE
                // =================================================

                chatHistories[sender].push({

                    role: 'model',

                    parts: [
                        {
                            text: replyText
                        }
                    ]

                });


                // LIMIT HISTORY AGAIN

                if (
                    chatHistories[sender].length > 8
                ) {

                    chatHistories[sender] =
                        chatHistories[sender]
                            .slice(-8);

                }


                // =================================================
                // STOP TYPING
                // =================================================

                await sock.sendPresenceUpdate(
                    'paused',
                    sender
                );


                // =================================================
                // SEND RESPONSE
                // =================================================

                await sock.sendMessage(
                    sender,
                    {
                        text: replyText
                    }
                );


                console.log(
                    'Pesan berhasil dijawab.'
                );


            } catch (error) {

                console.error(
                    'Error proses pesan:',
                    error
                );


                try {

                    await sock.sendPresenceUpdate(
                        'paused',
                        sender
                    );

                } catch (e) {}


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


// =====================================================
// WEB SERVER
// =====================================================

const PORT =
    process.env.PORT || 8080;


const server =
    http.createServer(
        (req, res) => {

            res.writeHead(
                200,
                {
                    'Content-Type':
                        'text/html; charset=utf-8'
                }
            );


            // =================================================
            // QR PAGE
            // =================================================

            if (latestQR) {

                const encodedQR =
                    encodeURIComponent(
                        latestQR
                    );


                const qrImageUrl =
                    'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' +
                    encodedQR;


                res.end(`
<!DOCTYPE html>
<html>

<head>

    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>Corner WhatsApp QR</title>

    <meta
        http-equiv="refresh"
        content="5"
    >

    <style>

        * {
            box-sizing: border-box;
        }

        body {

            margin: 0;

            min-height: 100vh;

            display: flex;

            justify-content: center;

            align-items: center;

            padding: 20px;

            font-family: Arial, sans-serif;

            background: #0f172a;

            color: white;

        }

        .card {

            width: 100%;

            max-width: 420px;

            text-align: center;

            background: #1e293b;

            padding: 30px;

            border-radius: 18px;

            box-shadow:
                0 10px 30px
                rgba(0,0,0,0.45);

        }

        h1 {

            margin-top: 0;

            margin-bottom: 10px;

        }

        p {

            color: #94a3b8;

            font-size: 14px;

        }

        img {

            width: 280px;

            height: 280px;

            max-width: 100%;

            margin-top: 15px;

            padding: 10px;

            background: white;

            border-radius: 10px;

        }

    </style>

</head>


<body>

    <div class="card">

        <h1>
            Scan QR Code Corner
        </h1>

        <p>
            Scan QR ini menggunakan WhatsApp.
        </p>

        <img
            src="${qrImageUrl}"
            alt="QR Code WhatsApp"
        >

        <p>
            Halaman akan memperbarui QR secara otomatis.
        </p>

    </div>

</body>

</html>
                `);

            }


            // =================================================
            // STATUS PAGE
            // =================================================

            else {

                res.end(`
<!DOCTYPE html>
<html>

<head>

    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>Corner Status</title>

    <meta
        http-equiv="refresh"
        content="10"
    >

    <style>

        * {
            box-sizing: border-box;
        }

        body {

            margin: 0;

            min-height: 100vh;

            display: flex;

            justify-content: center;

            align-items: center;

            padding: 20px;

            font-family: Arial, sans-serif;

            background: #0f172a;

            color: white;

            text-align: center;

        }

        .status {

            width: 100%;

            max-width: 500px;

            background: #1e293b;

            padding: 35px;

            border-radius: 18px;

            box-shadow:
                0 10px 30px
                rgba(0,0,0,0.45);

        }

        h1 {

            color: #4ade80;

            margin-top: 0;

        }

        p {

            color: #94a3b8;

        }

    </style>

</head>


<body>

    <div class="status">

        <h1>
            Corner [Multi-API Engine] Online!
        </h1>

        <p>
            Bot sudah terhubung atau siap siaga.
        </p>

    </div>

</body>

</html>
                `);

            }

        }
    );


// =====================================================
// START SERVER
// =====================================================

server.listen(
    PORT,
    '0.0.0.0',
    () => {

        console.log(
            'Server web & QR aktif di port ' +
            PORT
        );

        connectToWhatsApp();

    }
);
```
