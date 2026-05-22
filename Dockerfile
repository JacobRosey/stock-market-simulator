FROM node:22-bookworm

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    libhiredis-dev \
    libredis++-dev \
    nlohmann-json3-dev \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build
RUN npm run compile:cpp:linux
RUN npm prune --omit=dev

EXPOSE 3000

CMD ["bash", "./scripts/start-container.sh"]