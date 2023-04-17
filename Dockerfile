FROM node:lts
ENV NODE_OPTIONS=--openssl-legacy-provider
RUN echo 'npx ts-node generate-config.ts' >> ~/.bash_history