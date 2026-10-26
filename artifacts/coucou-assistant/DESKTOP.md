# IRIS para Windows e macOS

O pacote desktop usa Tauri para mostrar a ilha laranja e translúcida no topo do ecrã, por cima das outras aplicações. A interface continua a usar a Mochi, o motor Canvas e os comandos locais da versão web.

## Desenvolvimento e builds

Instala Node.js, pnpm e Rust stable. No Windows, instala também as ferramentas C++ do Visual Studio e o WebView2 Runtime. No macOS, instala as ferramentas de linha de comandos do Xcode.

Na raiz do repositório:

```sh
pnpm install
pnpm --filter @workspace/coucou-assistant run desktop:dev
```

Para criar um instalador, executa o comando no sistema operativo de destino:

```sh
# Windows
pnpm --filter @workspace/coucou-assistant run desktop:build:windows

# macOS
pnpm --filter @workspace/coucou-assistant run desktop:build:macos
```

Os ficheiros de instalação são gerados em `artifacts/coucou-assistant/src-tauri/target/release/bundle/`. O workflow `IRIS desktop builds` também cria pacotes para Windows e macOS e publica-os como artefactos da execução.

## Privacidade e permissões

A aplicação só mantém as tarefas e mensagens introduzidas pela pessoa utilizadora no armazenamento local da janela. Não lê títulos de janelas, teclas, rato, ecrã ou atividade de outras aplicações, e não instala hooks do sistema. Por isso, não pede permissões de Acessibilidade, gravação de ecrã ou privilégios de administrador. A janela usa apenas as capacidades nativas necessárias para ficar sempre visível, redimensionar a ilha e fechar a aplicação.

Os pacotes criados pelo workflow não são assinados nem notarizados. A publicação de uma versão assinada requer certificados próprios de cada plataforma.