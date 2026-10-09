FROM node:22

WORKDIR /app

COPY package.json package-lock.json ./
COPY services/control-center/package.json ./services/control-center/
COPY services/emergency-vehicle/package.json ./services/emergency-vehicle/
COPY services/sensors/water-sensor/package.json ./services/sensors/water-sensor/
COPY services/sensors/camera-sensor/package.json ./services/sensors/camera-sensor/
RUN npm ci --omit=dev --workspace=emergency-vehicle --include-workspace-root=false

COPY services/emergency-vehicle/ ./services/emergency-vehicle/
COPY services/shared/ ./services/shared/
COPY proto/ ./proto/

CMD ["node", "services/emergency-vehicle/vehicle.js"]
