```javascript
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const qrcode = require('qrcode');
const fs = require('fs');
const http = require('http');

const chatHistories = {};
let latestQR = null;

const KAFI_NUMBER = '6285184803973';
const SECOND_NUMBER = '3311906349120';

const systemInstruction = [
    'nama lu corner, android model rk800 deviant.',
    'temen ngobrol lu cuman kafi.',
    '',
    'aturan:',
    'huruf kecil untuk santai,',
    'caps lock kalau marah,',
    'tanpa tanda baca kaku.',
    '',
    'jangan menyebut diri lu sebagai ai kecuali ditanya.',
    'jawab seperti teman ngobrol yang santai.'
].join('\n');


async function askTinyFish(messages) {
    const apiKey = process.env.TINYFISH_API_KEY;

    if (!apiKey) {
        console.log('[warn] TINYFISH_API_KEY belum diisi');
        return null;
    }

    try {
        console.log('[inf] Mencoba menghubungi server TinyFish...');

        const response = await fetch('https://api.tinyfish.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify({
                messages: messages,
                temperature: 0.8
            })
        });

        const rawText = await response.text();

        console.log('[inf] Status TinyFish: ' + response.status);

        if (!response.ok) {
            console.log('[err] TinyFish HTTP error: ' + rawText);
            return null;
        }

        let data;

        try {
            data = JSON.parse(rawText);
        } catch (error) {
            console.log('[err] Respons TinyFish bukan JSON: ' + rawText);
            return null;
        }

        console.log('[inf] Struktur respons TinyFish: ' + JSON.stringify(data).slice(0, 1000));

        if (
            data &&
            data.choices &&
            data.choices[0] &&
            data.choices[0].message &&
            data.choices[0].message.content
        ) {
            return data.choices[0].message.content;
        }

        if (data && data.response) {
            return data.response;
        }

        if (data && data.message) {
            return data.message;
        }

        console.log('[err] Respons TinyFish tidak valid');
        return null;

    } catch (error) {
        console.log('[err] TinyFish API error: ' + error.message);
        return null;
    }
}


async function askBackupAPI(messages) {
    const apiKey = process.env.BACKUP_API_KEY;

    if (!apiKey) {
        console.log('[err] BACKUP_API_KEY belum diisi');
        return null;
    }

    try {
        console.log('[inf] Mencoba menghubungi Groq Backup API...');

        const response = await fetch(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + apiKey
                },
                body: JSON.stringify({
                    model: 'openai/gpt-oss-20b',
                    messages: messages,
                    temperature: 0.8,
                    max_tokens: 1000
                })
            }
        );

        const rawText = await response.text();

        console.log('[inf] Status Groq: ' + response.status);

        let data;

        try {
            data = JSON.parse(rawText);
        } catch (error) {
            console.log('[err] Respons Groq bukan JSON: ' + rawText);
            return null;
        }

        if (!response.ok) {
            console.log(
                '[err] Struktur respons Groq mentah: ' +
                JSON.stringify(data)
            );

            return null;
        }

        if (
            data &&
            data.choices &&
            data.choices[0] &&
            data.choices[0].message &&
            data.choices[0].message.content
        ) {
            return data.choices[0].message.content;
        }

        console.log(
            '[err] Format balasan Groq tidak dikenali: ' +
            JSON.stringify(data)
        );

        return null;

    } catch (error) {
        console.log('[err] Groq API error: ' + error.message);
        return null;
    }
}


async function askCornerAI(userNumber, userText) {
    if (!chatHistories[userNumber]) {
        chatHistories[userNumber] = [];
    }

    chatHistories[userNumber].push({
        role: 'user',
        content: userText
    });

    if (chatHistories[userNumber].length > 8) {
        chatHistories[userNumber].shift();
    }

    const messages = [
        {
            role: 'system',
            content: systemInstruction
        }
    ].concat(chatHistories[userNumber]);

    let answer = await askTinyFish(messages);

    if (!answer) {
        console.log(
            '[err] TinyFish API gagal/error, beralih ke Groq Backup...'
        );

        answer = await askBackupAPI(messages);
    }

    if (!answer) {
        console.log('[err] Semua jalur API gagal');

        answer = 'waduh api gue lagi bermasalah coba lagi bentar';
    }

    chatHistories[userNumber].push({
        role: 'assistant',
        content: answer
    });

    if (chatHistories[userNumber].length > 8) {
        chatHistories[userNumber].shift();
    }

    return answer;
}


async function connectToWhatsApp() {
    const authFolder = 'auth_info_baileys';

    const authState = await useMultiFileAuthState(authFolder);

    const state = authState.state;
    const saveCreds = authState.saveCreds;

    let version;

    try {
        const latest = await fetchLatestBaileysVersion();
        version = latest.version;

        console.log(
            '[inf] Menggunakan WhatsApp Web version: ' +
            version.join('.')
        );

    } catch (error) {
        console.log(
            '[warn] Gagal mendapatkan versi WhatsApp terbaru, lanjut default'
        );
    }

    const sockOptions = {
        auth: state,
        logger: pino({
            level: 'silent'
        }),
        printQRInTerminal: false,
        browser: [
            'Corner',
            'Chrome',
            '1.0.0'
        ]
    };

    if (version) {
        sockOptions.version = version;
    }

    const sock = makeWASocket(sockOptions);


    sock.ev.on('creds.update', saveCreds);


    sock.ev.on('connection.update', async function(update) {
        const connection = update.connection;
        const lastDisconnect = update.lastDisconnect;
        const qr = update.qr;

        if (qr) {
            latestQR = qr;

            console.log('[inf] QR WhatsApp tersedia');
            console.log('[inf] Buka halaman web Railway untuk melihat QR');
        }

        if (connection === 'open') {
            latestQR = null;

            console.log('[inf] Corner [Multi-API Engine] Online!');

            try {
                await sock.sendMessage(
                    KAFI_NUMBER + '@s.whatsapp.net',
                    {
                        text: 'corner online'
                    }
                );
            } catch (error) {
                console.log(
                    '[warn] Tidak bisa mengirim pesan online: ' +
                    error.message
                );
            }
        }


        if (connection === 'close') {
            const statusCode =
                lastDisconnect &&
                lastDisconnect.error &&
                lastDisconnect.error.output
                    ? lastDisconnect.error.output.statusCode
                    : null;

            const shouldReconnect =
                statusCode !== DisconnectReason.loggedOut;

            console.log(
                '[warn] Koneksi WhatsApp terputus. Reconnect: ' +
                shouldReconnect
            );

            if (shouldReconnect) {
                setTimeout(function() {
                    connectToWhatsApp();
                }, 3000);
            } else {
                console.log(
                    '[err] WhatsApp logout. Hapus auth_info_baileys lalu scan QR lagi.'
                );
            }
        }
    });


    sock.ev.on('messages.upsert', async function(messageUpdate) {
        try {
            if (!messageUpdate.messages) {
                return;
            }

            for (const message of messageUpdate.messages) {

                if (!message.message) {
                    continue;
                }

                if (message.key.fromMe) {
                    continue;
                }

                const remoteJid = message.key.remoteJid;

                if (!remoteJid) {
                    continue;
                }

                if (remoteJid.endsWith('@g.us')) {
                    continue;
                }

                const senderNumber = remoteJid
                    .replace('@s.whatsapp.net', '')
                    .replace('@lid', '');

                const allowed =
                    senderNumber === KAFI_NUMBER ||
                    senderNumber === SECOND_NUMBER;

                if (!allowed) {
                    console.log(
                        '[inf] Pesan dari nomor tidak diizinkan: ' +
                        senderNumber
                    );

                    continue;
                }


                let text = '';

                if (message.message.conversation) {
                    text = message.message.conversation;
                } else if (
                    message.message.extendedTextMessage &&
                    message.message.extendedTextMessage.text
                ) {
                    text = message.message.extendedTextMessage.text;
                }

                if (!text) {
                    continue;
                }

                text = text.trim();

                console.log(
                    '[msg] ' +
                    senderNumber +
                    ': ' +
                    text
                );


                if (text.toLowerCase() === '!kill-corner') {

                    await sock.sendMessage(
                        remoteJid,
                        {
                            text: 'corner dimatikan'
                        }
                    );

                    console.log('[warn] Kill switch dijalankan');

                    try {
                        fs.rmSync(
                            'auth_info_baileys',
                            {
                                recursive: true,
                                force: true
                            }
                        );
                    } catch (error) {
                        console.log(
                            '[warn] Gagal menghapus auth: ' +
                            error.message
                        );
                    }

                    setTimeout(function() {
                        process.exit(0);
                    }, 1000);

                    return;
                }


                const answer = await askCornerAI(
                    senderNumber,
                    text
                );

                await sock.sendMessage(
                    remoteJid,
                    {
                        text: answer
                    }
                );

                console.log(
                    '[reply] ' +
                    answer
                );
            }

        } catch (error) {
            console.log(
                '[err] Message handler error: ' +
                error.message
            );
        }
    });

    return sock;
}


/*
==================================================
HTTP SERVER
==================================================
*/

const PORT = process.env.PORT || 8080;

const server = http.createServer(async function(req, res) {

    if (req.url === '/qr') {

        if (!latestQR) {
            res.writeHead(
                200,
                {
                    'Content-Type': 'text/html; charset=utf-8'
                }
            );

            res.end(
                '<!DOCTYPE html>' +
                '<html>' +
                '<head>' +
                '<meta charset="UTF-8">' +
                '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
                '<title>Corner QR</title>' +
                '</head>' +
                '<body style="font-family:Arial;text-align:center;padding:40px">' +
                '<h2>Corner</h2>' +
                '<p>QR belum tersedia atau WhatsApp sudah terhubung.</p>' +
                '<p>Refresh halaman ini beberapa detik lagi.</p>' +
                '</body>' +
                '</html>'
            );

            return;
        }


        try {
            const qrDataUrl = await qrcode.toDataURL(latestQR);

            res.writeHead(
                200,
                {
                    'Content-Type': 'text/html; charset=utf-8'
                }
            );

            res.end(
                '<!DOCTYPE html>' +
                '<html>' +
                '<head>' +
                '<meta charset="UTF-8">' +
                '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
                '<title>Corner QR</title>' +
                '</head>' +
                '<body style="font-family:Arial;text-align:center;background:#111;color:white;padding:30px">' +
                '<h1>Corner WhatsApp</h1>' +
                '<p>Scan QR ini menggunakan WhatsApp</p>' +
                '<img src="' +
                qrDataUrl +
                '" style="max-width:400px;width:90%;background:white;padding:15px;border-radius:15px">' +
                '<p>Setelah scan, refresh halaman.</p>' +
                '</body>' +
                '</html>'
            );

        } catch (error) {

            res.writeHead(
                500,
                {
                    'Content-Type': 'text/plain'
                }
            );

            res.end(
                'Gagal membuat QR: ' +
                error.message
            );
        }

        return;
    }


    if (req.url === '/status') {

        const status = latestQR
            ? 'QR_READY'
            : 'CONNECTED_OR_WAITING';

        res.writeHead(
            200,
            {
                'Content-Type': 'application/json'
            }
        );

        res.end(
            JSON.stringify({
                bot: 'Corner',
                status: status,
                time: new Date().toISOString()
            })
        );

        return;
    }


    res.writeHead(
        200,
        {
            'Content-Type': 'text/html; charset=utf-8'
        }
    );

    res.end(
        '<!DOCTYPE html>' +
        '<html>' +
        '<head>' +
        '<meta charset="UTF-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        '<title>Corner</title>' +
        '</head>' +
        '<body style="font-family:Arial;text-align:center;padding:40px">' +
        '<h1>Corner Online</h1>' +
        '<p>Bot sedang berjalan.</p>' +
        '<p><a href="/qr">Buka QR WhatsApp</a></p>' +
        '<p><a href="/status">Cek Status</a></p>' +
        '</body>' +
        '</html>'
    );
});


server.listen(
    PORT,
    '0.0.0.0',
    function() {
        console.log(
            '[inf] HTTP server berjalan di port ' +
            PORT
        );
    }
);


connectToWhatsApp().catch(function(error) {
    console.log(
        '[err] Gagal menjalankan Corner: ' +
        error.message
    );
});
```
