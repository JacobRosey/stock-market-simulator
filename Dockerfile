FROM node:22-bookworm

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    ca-certificates \
    libhiredis-dev \
    nlohmann-json3-dev \
  && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 https://github.com/sewenew/redis-plus-plus.git /tmp/redis-plus-plus \
  && cd /tmp/redis-plus-plus \
  && mkdir build \
  && cd build \
  && cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DREDIS_PLUS_PLUS_BUILD_TEST=OFF \
    -DREDIS_PLUS_PLUS_CXX_STANDARD=17 \
  && make -j"$(nproc)" \
  && make install \
  && ldconfig \
  && rm -rf /tmp/redis-plus-plus

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build
RUN npm run compile:cpp:linux
RUN npm prune --omit=dev

EXPOSE 3000

CMD ["bash", "./scripts/start-container.sh"]