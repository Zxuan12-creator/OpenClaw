const http = require('http');
const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OpenClaw Bot is running 24/7 with Gemini AI!');
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
