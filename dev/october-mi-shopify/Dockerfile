FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

# Shopify CLI is not needed at runtime.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Remove the CLI from the production image if present.
RUN npm remove @shopify/cli || true

COPY . .

RUN npm run build

CMD ["npm", "run", "docker-start"]
