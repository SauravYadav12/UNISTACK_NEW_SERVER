
# Base Stage: Install dependencies and build
FROM node:20-alpine AS base

# Copy package.json and install dependencies
COPY package.json ./
RUN npm install

# Copy the application source code and config files
COPY . .
COPY tsconfig.json ./tsconfig.json

# Copy the .env file for environment variables
COPY config.env ./config.env

# Build the application
RUN npm run build

# Production Stage: Copy only necessary files for runtime
FROM node:20-alpine

# Copy the built files and node_modules from the base stage
COPY --from=base ./node_modules ./node_modules
COPY --from=base ./package.json ./package.json
COPY --from=base /dist /dist

# Copy the .env file into the production container
COPY config.env ./config.env

# Expose the port that the application listens on
EXPOSE 8080

# Start the application
CMD ["npm", "run", "start"]