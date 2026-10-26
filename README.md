# IRIS — Frontend

Repositório público apenas da interface frontend da IRIS, construída com React, TypeScript e Vite. Inclui o cliente TypeScript usado pela interface. O servidor API, as credenciais, o agente LiveKit e os serviços de backend não estão neste repositório.

## Requisitos
- Node.js 20 ou superior
- pnpm 9 ou superior

## Desenvolvimento
```sh
pnpm install
PORT=20827 BASE_PATH=/ pnpm dev
```

## Compilação
```sh
PORT=20827 BASE_PATH=/ pnpm build
```

A interface pode precisar do backend IRIS separado para conversas e voz. Não coloque credenciais no frontend.
