FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY eslint.config.js tsconfig*.json ./

RUN pnpm install --frozen-lockfile
RUN pnpm build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV AGENT_POPPY_DATA_DIR=/app/data
ENV AGENT_POPPY_WEB_DIST=/app/apps/web/dist

EXPOSE 3001

CMD ["pnpm", "--filter", "@agent-poppy/server", "start"]
