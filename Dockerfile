# Use official Node.js 22 image
FROM node:22-slim

# Install system dependencies for pdf2pic
RUN apt-get update && apt-get install -y \
    graphicsmagick \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN yarn install

# Copy application code
COPY . .

# Expose the port your app runs on
EXPOSE 5000

# Start your app
CMD ["node", "server.js"]
