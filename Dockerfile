FROM node:20

# Set working directory
WORKDIR /app

# Install only what’s needed first: improves caching
COPY package*.json ./

# ⬅️ This is where npm install happens
RUN npm install

# Now copy the rest of your app
COPY . .

# Build your app (if needed)
RUN npm run build

# Start your server
CMD ["npm", "start"]
