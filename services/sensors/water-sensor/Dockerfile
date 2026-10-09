FROM node:22

WORKDIR /app

COPY package.json package-lock.json ./
COPY services/control-center/package.json ./services/control-center/
COPY services/emergency-vehicle/package.json ./services/emergency-vehicle/
COPY services/sensors/water-sensor/package.json ./services/sensors/water-sensor/
COPY services/sensors/camera-sensor/package.json ./services/sensors/camera-sensor/
RUN npm ci --omit=dev --workspace=water-sensor --include-workspace-root=false

COPY services/sensors/water-sensor/ ./services/sensors/water-sensor/
COPY services/shared/ ./services/shared/

CMD ["node", "services/sensors/water-sensor/sensor.js"]
