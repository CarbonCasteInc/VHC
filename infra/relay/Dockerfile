FROM node:20.16.0-alpine3.19

WORKDIR /app

# Install the exact Gun version used in the monorepo
RUN npm install gun@0.2020.1237

COPY server.js /app/server.js

EXPOSE 7777

CMD ["node", "server.js"]
