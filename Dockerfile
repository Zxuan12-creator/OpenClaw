FROM node:18-alpine
WORKDIR /app
RUN npm install -g openclaw
EXPOSE 18789
CMD ["openclaw", "gateway", "start"]
