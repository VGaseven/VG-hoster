FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV DB_FILE=/data/bridge.db
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
