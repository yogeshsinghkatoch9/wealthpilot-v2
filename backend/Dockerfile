FROM node:20-alpine

WORKDIR /app

# Install dependencies for Prisma
RUN apk add --no-cache openssl

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY src ./src

# Create non-root user
RUN addgroup -S app && adduser -S app -G app
RUN chown -R app:app /app
USER app

EXPOSE 4000

CMD ["npm", "start"]
