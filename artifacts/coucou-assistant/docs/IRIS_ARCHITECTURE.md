# IRIS architecture

## Current application

- The interface is a React/TypeScript application built with Vite and shared by the browser preview and Tauri desktop shell.
- `App.tsx` owns the main UI state. The active interface exposes conversation, voice, settings, help, Mochi, and the Dynamic Island. Existing task, inbox/capture, project, and focus records remain in their current local-storage keys but are no longer exposed or written by the UI.
- The Express API currently exposes health, `/api/iris/chat`, and `/api/iris/speech`. It has no Duvion endpoints, business-data APIs, or authentication routes.
- A server-side provider interface selects Gemini through Replit AI Integrations by default; `AI_PROVIDER=openai` explicitly selects OpenAI. Both providers are lazy and make requests only after user interaction. Gemini does not access Duvion or local app records.
- The mock provider uses a small, fictional demo dataset and simulated actions. Replies label this content as demonstration; simulated writes never touch Duvion or local IRIS records. Mock voice uses browser speech synthesis.
- Legacy task, inbox, project, file, and focus data are not included in provider requests and must not be cleared or migrated as part of unrelated AI work.

## IRIS Core and tools

- `IrisCore` selects providers per capability. `LocalProvider` currently supplies every persisted-state and attachment capability.
- The browser-side `IrisToolRegistry` is only a generic local utility; it is not an authorization boundary and must not execute Duvion operations.
- The API server now has a central tool-execution contract. It requires a verified user and organization, an explicit permission, an audit sink before execution, one-use confirmation for medium/high-risk tools, and step-up authentication for high-risk tools.
- The server registry has no registered tools, caller, authentication bridge, confirmation service, or audit database. It fails closed when those services are absent and is not a Duvion integration.
- Requests to use or inspect removed local productivity features are answered locally with an availability notice and are not sent to an AI provider.
- The Duvion-facing tools, verified organization context, real confirmation/audit services, and Duvion provider are not implemented.

## Conversation and voice

- The chat API accepts a user message and a bounded conversation history. The client sends recent AI-sourced turns; local action content stays local.
- The OpenAI assistant can answer general questions, but has no access to Duvion or local app records. It must not invent company data or claim to perform actions.
- The mock assistant can exercise selected demo-tool paths using explicitly fictional values; those are not live Duvion information or completed operations.
- One `AudioController` coordinates browser/WebView speech recognition, wake-word standby, voice-state events, and the configured speech provider. Browser/WebView speech recognition may process audio under its own rules; IRIS does not persist recordings.
- The voice turn handler applies the same local availability notice as text, then uses the configured provider for other messages only when enabled. Mochi's existing visual identity remains independent of spoken output.

## Duvion integration boundary

- The current workspace contains no Duvion source, API contract, authentication flow, or business data. Real company analysis and Duvion actions cannot be implemented or tested until an authoritative source is available.
- Live mode must never simulate Duvion records, invent endpoints or permissions, or claim an action succeeded without a connected implementation. Fictional demo data/actions are allowed only in the explicit mock provider and must remain visibly labeled and isolated.
- Keep IRIS's local productivity records separate from Duvion business data and from OpenAI requests.
- Implement Duvion access in server-side tools with verified identity, organization scope, permission checks, risk levels, explicit confirmation for writes, and audit records once the real API and auth model are available.
