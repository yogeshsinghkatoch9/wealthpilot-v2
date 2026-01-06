FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src ./src
COPY views ./views

# Create non-root user
RUN addgroup -S app && adduser -S app -G app
RUN chown -R app:app /app
USER app

EXPOSE 3000

CMD ["npm", "start"]
