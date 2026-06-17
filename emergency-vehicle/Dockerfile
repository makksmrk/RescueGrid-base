FROM node:22

WORKDIR /app

COPY emergency-vehicle/package*.json ./
RUN npm install

COPY emergency-vehicle ./emergency-vehicle
COPY proto ./proto

CMD ["node", "emergency-vehicle/vehicle.js"]
