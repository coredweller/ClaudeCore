---
name: riverpod-patterns
description: "This skill provides Riverpod state management patterns and best practices for Flutter applications. Use when reviewing or writing Riverpod providers, AsyncValue handling, ref usage, or provider lifecycle management."
allowed-tools: Read
---

# Riverpod Patterns

Correct Riverpod patterns for Flutter state management with code_generation style.

**When to use:** Writing or reviewing Riverpod providers, AsyncNotifier, AsyncValue.when, ref.watch vs ref.read, family providers, or provider lifecycle.

**Process:**

1. **Identify pattern needed** from user request
2. **Load reference:** Read `reference/riverpod-core-patterns.md` for code examples and rules
3. **Apply patterns** using loaded reference
4. **Verify:** Confirm ref.watch is only in build(), ref.read only in callbacks, all AsyncValue states handled visibly

## Reference Files

| File | Contents |
|------|----------|
| `reference/riverpod-core-patterns.md` | Code examples, provider types, ref usage rules |
| `reference/riverpod-review-checklist.md` | Review checklist for Riverpod code audits (used by `riverpod-reviewer` agent) |

## Error Handling

**Provider not found**: Ensure `ProviderScope` wraps the widget tree. Check that generated `.g.dart` files are up to date (`dart run build_runner build`).

**AsyncValue stuck loading**: Verify the repository method returns data. Use `AsyncValue.guard()` to catch and surface errors instead of silent failures.
