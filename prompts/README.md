# Prompts

Versioned AI prompt templates used by the backend's OpenAI integration (`backend/src/infrastructure/openai/`).

- `system/` — system prompts that define assistant behavior/persona per feature.
- `templates/` — reusable prompt templates with variable placeholders, consumed by backend AI services.

Keeping prompts as version-controlled files (rather than inline strings) allows them to be reviewed, diffed, and iterated on independently of application code.

No prompt content exists yet — templates are added alongside the AI features that use them.
