FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build -- --configuration production

FROM nginx:alpine
ARG PORT=80
ENV PORT=${PORT}
EXPOSE ${PORT}
# Only substitute ${PORT} in the nginx template; leave $uri/$host/etc. intact.
ENV NGINX_ENVSUBST_FILTER="^PORT$"
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/*/browser /usr/share/nginx/html
