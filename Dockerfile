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
RUN npm ci --omit=dev

COPY . .
RUN npm run compile:cpp:linux

EXPOSE 3000

CMD ["npm", "run", "start:container"]
