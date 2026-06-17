FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

EXPOSE 3000

ENV NODE_ENV=production

CMD ["npm", "start"]
