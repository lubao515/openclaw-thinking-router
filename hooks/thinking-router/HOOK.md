---
name: thinking-router
description: "Auto-route direct-chat session thinking levels using simple risk/complexity rules and sessions.patch."
metadata: { "openclaw": { "emoji": "🧠", "events": ["message:preprocessed"] } }
---

# Thinking Router

Primary execution mechanism for main-session thinking-tier routing in supported chats.

Behavior:
- classifies incoming text as low / medium / high
- persists `thinkingLevel` via `sessions.patch`
- respects explicit `/thinking ...` commands by entering a temporary manual-hold window
- avoids noisy re-patching with sticky windows and dedupe
- serves as the execution layer; semantic routing policy lives in workspace guidance/memory
