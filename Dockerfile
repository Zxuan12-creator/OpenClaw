FROM node:18-alpine
WORKDIR /app
RUN npm init -y && npm install openclaw
CMD ["node", "node_modules/openclaw/index.js"]
