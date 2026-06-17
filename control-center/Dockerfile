FROM node:22

WORKDIR /app

COPY control-center/package*.json ./
RUN npm install

COPY control-center ./control-center
COPY proto ./proto

CMD ["node", "control-center/server.js"]
