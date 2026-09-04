FROM --platform=linux/arm64 node:22-slim
WORKDIR /app
COPY server.mjs ./
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
