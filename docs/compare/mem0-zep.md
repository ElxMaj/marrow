# Marrow vs Mem0 / Zep

Mem0 and Zep are memory layers for conversational agents. They remember what a user said so the next chat feels continuous. Marrow is a product-knowledge layer for engineering teams: it remembers what the team decided so the next agent builds on the right constraints.

|  | Mem0 / Zep | Marrow |
|---|---|---|
| Memory unit | User message / session | Evidence span → distilled fact |
| Update model | Accumulate and forget | Decided facts are stable; open questions wait for a human |
| Confidence | Implicit | Explicit status and confidence on every fact |
| Provenance | Conversation ID | Exact source span in the original transcript or doc |
| Target user | Chatbot user | Product + engineering team building with coding agents |

Use Mem0 or Zep for agent chat memory. Use Marrow for team decisions that survive across sprints and repos.
