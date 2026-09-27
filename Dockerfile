FROM node:18-alpine
WORKDIR /app
RUN npm install -g openclaw
EXPOSE 8080
CMD ["openclaw"]
