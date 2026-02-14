FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY server.js ./

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

# Start the server
CMD ["node", "server.js"]
