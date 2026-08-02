# ---- Development stage ----
FROM node:18-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---- Build stage ----
FROM node:18-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
# Default API URL uses a relative path so it works behind the nginx reverse proxy.
# Override at build time with --build-arg VITE_API_URL=<url> if needed.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_DEBUG_CONSOLE=false
ENV VITE_DEBUG_CONSOLE=$VITE_DEBUG_CONSOLE
RUN npm run build

# ---- Production stage ----
FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
