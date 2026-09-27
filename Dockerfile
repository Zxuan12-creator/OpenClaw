FROM node:18-alpine
WORKDIR /app
RUN npm init -y && npm install openclaw
EXPOSE 8080
CMD ["node", "-e", "require('openclaw')"]
