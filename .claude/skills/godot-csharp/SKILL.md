---
name: godot-csharp-best-practices
description: "Guide AI agents through Godot 4.x C# coding best practices including scene organization, signals, resources, state machines, and performance optimization. This skill should be used when generating C# code for Godot, creating Godot scenes, designing game architecture, implementing state machines, object pooling, save/load systems, or when the user asks about C# patterns, node structure, or Godot C# standards. Keywords: godot, csharp, c#, game development, signals, resources, scenes, nodes, state machine, object pooling, save system, autoload, export, partial class."
license: MIT
compatibility: Requires Godot 4.x project with .NET enabled (C# support).
metadata:
  author: agent-skills
  version: "1.0"
  godot_version: "4.x"
  type: utility
  mode: assistive
  domain: gamedev
---

# Godot 4.x C# Best Practices

Guide AI agents in writing high-quality C# code for Godot 4.x. This skill provides coding standards, architecture patterns, and templates for game development using the Godot C# API.

## When to Use This Skill

Use this skill when:
- Generating new C# scripts for Godot
- Creating or organizing Godot scenes with C#
- Designing game architecture and node hierarchies
- Implementing state machines, object pools, or save systems in C#
- Answering questions about Godot C# patterns or conventions
- Reviewing C# Godot code for quality issues

Do NOT use this skill when:
- Working with GDScript in Godot (use `godot-gdscript` skill)
- Working with Godot 3.x (API and C# bindings differ significantly)
- Using GDExtension/C++ (different paradigm)
- Building non-Godot C# applications (use `csharp-dotnet-api` skill)

## Core Principles

### 1. Naming Conventions

Classes and methods are PascalCase. Private fields use `_camelCase`. Signals use the `[Signal]` attribute with a `delegate void …EventHandler` name. Constants are PascalCase (SCREAMING_SNAKE_CASE is also accepted).

See `references/csharp/type-system.md` → **Naming Conventions**.

### 2. Partial Classes (Required)

All Godot node scripts **must** use `partial class`. This is required for the source generator to wire up `[Signal]` and `[Export]` attributes.

See `references/csharp/type-system.md` → **Partial Classes**.

### 3. Exports and Node References

Use `[Export]` for editor-configurable values. Use `[ExportGroup]` to organise them in the inspector. Fetch node references in `_Ready()` with `GetNode<T>()`. Use `%UniqueName` for stable cross-hierarchy references.

See `references/architecture/scene-composition.md` → **Exports and Node References**.

### 4. Signal-Driven Architecture

Use signals for decoupled communication. Follow "signal up, call down": children emit signals, parents connect to them. Never call parent methods from a child.

See `references/architecture/node-communication.md` → **Signal-Driven Architecture**.

### 5. Signal Naming

Use `EmitSignal(SignalName.X, args)` for type-safe emission. Prefer C# event syntax (`node.Signal += Handler`) for connection and disconnection.

See `references/architecture/node-communication.md` → **Signal Naming**.

### 6. Resource Loading

Cache `GD.Load<T>()` results in `static readonly` fields — never call it inside `_Process`. Use `ResourceLoader.LoadThreadedRequest` for async scene loading. Always instantiate typed scenes with `PackedScene.Instantiate<T>()`.

See `references/architecture/scene-composition.md` → **Resource Loading**.

## Quick Reference

| Category | Prefer | Avoid |
|----------|--------|-------|
| Node references | `GetNode<T>("Path")` in `_Ready()` | `GetNode()` everywhere |
| Unique nodes | `GetNode<T>("%UniqueName")` | Deep paths `A/B/C/D` |
| Signal connection | C# event syntax `node.Signal += Handler` | String-based `Connect("signal", ...)` |
| Signal emission | `EmitSignal(SignalName.X, args)` | String: `EmitSignal("x", args)` |
| Null checks | `IsInstanceValid(node)` | `node != null` for freed nodes |
| Partial class | Always `partial class` | Non-partial Godot node class |
| Coroutines | `await ToSignal(...)` | Manual timer polling |
| Resource load | `GD.Load<T>()` cached as static | `GD.Load<T>()` in `_Process` |
| Logging | `GD.Print()`, `GD.PushError()` | `Console.WriteLine()` |
| Autoloads | Services/managers only | Game logic in autoloads |
| Communication | Signal up, call down | Child calling parent methods |

## Code Generation Guidelines

### Script Structure

Order sections: `using` directives → XML doc comment → signals → enums → exports → constants → public properties → private fields → lifecycle methods (`_Ready`, `_Process`, `_PhysicsProcess`) → public methods → private methods → signal handlers.

See `assets/templates/base-script.cs.md` for the full annotated template.

## Common Game Patterns

### State Machine

Use enum-based state machines for simple entities; node-based `StateMachine` class for complex per-state logic.

See `references/patterns/state-machine.md` for all patterns and a complete Player example.

### Object Pooling

Pre-instantiate frequently-spawned objects (bullets, particles) to avoid per-frame allocation cost.

See `references/patterns/object-pooling.md` for `SimplePool`, `PoolManager` autoload, and the `Poolable` interface.

### Save/Load

Use `Resource` subclasses for structured, type-safe save data. Use JSON for human-readable or cross-platform saves.

See `references/patterns/save-load-system.md` for resource-based saves, JSON, versioning, and encryption.

## Common Anti-Patterns

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| Non-partial class | Breaks signal/export source gen | Always use `partial class` |
| `GetNode()` in `_Process` | Called every frame, wasteful | Cache in `_Ready()` |
| `GD.Load<T>()` in `_Process` | Disk reads every frame | Cache as static field |
| String signals `EmitSignal("x")` | Typos, no autocomplete | Use `SignalName.X` |
| `Console.WriteLine()` | Bypasses Godot output | Use `GD.Print()` |
| `node != null` for freed nodes | Returns true for freed objects | `IsInstanceValid(node)` |
| Deep node paths `A/B/C/D` | Breaks on refactor | Use `%UniqueName` |
| Child calling parent methods | Tight coupling | Signal up, call down |
| Circular dependencies | Load errors, unclear flow | Dependency injection or signals |
| Logic in autoloads | Testing difficulty, coupling | Keep autoloads thin |
| `new()` for Godot objects | Memory issues, not tracked | Always use `Instantiate()` or `new()` only for RefCounted |

## Additional Resources

### Pattern Guides
- `references/patterns/state-machine.md` - Full state machine implementations
- `references/patterns/object-pooling.md` - Complete pooling system
- `references/patterns/save-load-system.md` - Comprehensive save/load guide
- `references/patterns/input-handling.md` - Input buffering and rebinding

### Architecture
- `references/architecture/project-structure.md` - Directory organization
- `references/architecture/scene-composition.md` - Scene design patterns
- `references/architecture/node-communication.md` - Signals vs direct calls

### C# Deep Dives
- `references/csharp/type-system.md` - C# types in the Godot API
- `references/csharp/async-await.md` - Async patterns with ToSignal

### Templates
- `assets/templates/base-script.cs.md` - Standard script template
- `assets/templates/state-machine.cs.md` - State machine template
- `assets/templates/autoload-manager.cs.md` - Autoload singleton template

## Limitations

- C# / .NET only (not GDScript, GDExtension, or VisualScript)
- Godot 4.x API (bindings differ significantly from Godot 3.x)
- Game-focused patterns (not editor plugin development)
- Requires .NET 8 SDK installed and Godot .NET build
