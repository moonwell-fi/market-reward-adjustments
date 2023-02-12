FROM node:lts
RUN echo 'npx ts-node generate-config.ts' >> ~/.bash_history