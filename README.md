# chegai-server

API do Chegaí: agendamento, gestão e WhatsApp para barbearias.

## Stack

- Node.js 22, NestJS, TypeScript
- PostgreSQL + Prisma
- Redis + BullMQ
- n8n para o agente de atendimento no WhatsApp

## Rodando localmente

```bash
cp .env.example .env
docker compose up -d
yarn install
yarn dev
```

A API sobe em `http://localhost:3333` e o health check fica em `GET /health`.
