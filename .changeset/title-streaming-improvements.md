---
"@sylphx/code-core": patch
"@sylphx/code-server": patch
---

Fix title streaming delays and improve architecture

**Title Streaming Performance**
- Fix parallel API requests timing issue - title generation now starts simultaneously with main response instead of 300ms+ later
- Add `disableReasoning` option to prevent AI from spending 3+ seconds on extended thinking during title generation
- Title should now arrive faster and sometimes before main response completes

**Architecture Improvements**
- Modularize reasoning control to provider layer via `buildProviderOptions()` method
- Remove provider-specific code from core AI SDK (was hardcoded to OpenRouter)
- Add `StreamingOptions` interface for provider-agnostic configuration
- Providers now translate generic options to their own API format

**Title Quality**
- Improve title generation prompt with clear requirements (2-6 words, no filler)
- Add few-shot examples for better guidance
- Titles should be more concise and descriptive
