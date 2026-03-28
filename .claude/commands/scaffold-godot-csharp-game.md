---
description: Scaffold a new Godot 4.x C# game skeleton with project structure, autoloads, Actor base class, Player scene, and MainMenu
argument-hint: "[GameName]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
disable-model-invocation: true
---

# Scaffold Godot 4.x C# Game Skeleton

**Game name:** $ARGUMENTS (default to "MyGame" if not provided)

Delegate to the `godot-csharp` skill for all patterns, templates, and conventions.

## Pre-requisites

1. Read the `godot-csharp` skill (`SKILL.md` and all reference files under `references/`) before writing any code.
2. All scripts **must** use `partial class` — required for Godot's source generator to wire up `[Signal]` and `[Export]`.
3. Follow the section order from `assets/templates/base-script.cs.md` for every script.

## Steps

1. **Create directory structure** — Create the standard layout under `./$ARGUMENTS/`. Read `references/architecture/project-structure.md` for the full tree, including `assets/`, `autoloads/`, `components/`, `resources/`, `scenes/actors/player/`, `scenes/levels/`, `scenes/ui/`, `scripts/classes/`, `scripts/utils/`, and `data/`.

2. **Create `.csproj`** — Write `$ARGUMENTS/$ARGUMENTS.csproj` with `Godot.NET.Sdk`, `net8.0`, `EnableDynamicLoading`, `Nullable`, `ImplicitUsings`, and `TreatWarningsAsErrors`. Read `references/architecture/project-structure.md` → **.csproj Configuration** for the exact template. Do **not** create a `.sln` file — Godot generates it automatically on first project open.

3. **Create `.gitignore`** — Cover `.godot/`, `.vs/`, `bin/`, `obj/`, `*.user`, `*.pck`, `*.zip`, `build/`, `.DS_Store`, `.idea/`, `.vscode/`. Read `references/architecture/project-structure.md` → **Git Configuration** for the exact template.

4. **Create `project.godot`** — Set `run/main_scene` to `res://scenes/ui/MainMenu.tscn`. Register three autoloads: `EventBus`, `GameManager`, and `AudioManager` (autoload paths must be prefixed with `*`). Set `dotnet/project/assembly_name` to `$ARGUMENTS`. Read `references/architecture/project-structure.md` → **project.godot Configuration** for the exact INI format and key points.

5. **Create `autoloads/EventBus.cs`** — Global event bus with signals for game state (started, paused, resumed, game over), player (died, health changed), and level (started, completed) events. Keep it signal-only — no logic. Read `assets/templates/autoload-manager.cs.md` → **Event Bus Example** for the pattern.

6. **Create `autoloads/GameManager.cs`** — Manages pause state and scene transitions (`GoToScene`, `StartGame`, `ReturnToMainMenu`, `TogglePause`). Emits `EventBus` signals on state changes. Set `ProcessMode = ProcessModeEnum.Always` in `_Ready()` so it runs while paused. Read `assets/templates/autoload-manager.cs.md` → **Basic Manager Template** for the pattern.

7. **Create `autoloads/AudioManager.cs`** — Music and SFX playback with volume control per bus. Read `assets/templates/autoload-manager.cs.md` → **Audio Manager Example** for the full implementation.

8. **Create `components/HealthComponent.cs`** — Reusable `Node` component with `[Export] MaxHealth`, `TakeDamage(int)`, `Heal(int)`, `HealthChanged` signal, and `Died` signal. Read `references/architecture/project-structure.md` → **components/** for the pattern.

9. **Create `scripts/classes/Actor.cs`** — Base `CharacterBody2D` with `[Export] MoveSpeed`, wires up `HealthComponent.Died` in `_Ready`, emits own `Died` signal, and provides a `virtual OnDied()` method. Read `references/architecture/project-structure.md` → **scripts/** for the pattern.

10. **Create `scenes/actors/player/Player.cs`** — Extends `Actor`. This scaffold produces a **top-down 2D** player. Read 4-directional input via `Input.GetVector("ui_left", "ui_right", "ui_up", "ui_down")` in `_PhysicsProcess` and call `MoveAndSlide`. Override `OnDied` to emit `EventBus.PlayerDied` then call `base.OnDied()` (which calls `QueueFree`). Read `assets/templates/base-script.cs.md` for script structure.

11. **Create `scenes/actors/player/Player.tscn`** — `CharacterBody2D` root with `Player.cs` script. Children: `HealthComponent` node, `CollisionShape2D`, `Sprite2D`. Read `references/architecture/scene-composition.md` for scene file conventions.

12. **Create `scenes/levels/Level01.tscn`** — `Node2D` root. Instances `Player.tscn` at a spawn position. Includes a `TileMapLayer` node (deprecated `TileMap` was replaced in Godot 4.3+) and a `Camera2D` child on the Player. Read `references/architecture/scene-composition.md` → **Nested Scenes** for the pattern.

13. **Create `scenes/ui/MainMenu.cs`** — `Control` node. Gets `%PlayButton` and `%QuitButton` in `_Ready`. `PlayButton.Pressed` calls `GameManager.StartGame()`; `QuitButton.Pressed` calls `GetTree().Quit()`. Read `assets/templates/base-script.cs.md` for the minimal template.

14. **Create `scenes/ui/MainMenu.tscn`** — Full-rect `Control` with a centred `VBoxContainer` containing a title `Label`, `%PlayButton`, and `%QuitButton` (both marked `unique_name_in_owner = true`). Attach `MainMenu.cs`.

15. **Configure Claude** — Copy from this repository into `$ARGUMENTS/.claude/`: `rules/core-behaviors.md`, `rules/code-standards.md`, `rules/verification-and-reporting.md`, `agents/csharp-expert.md`, `agents/code-reviewer.md`, `agents/security-reviewer.md`, and the entire `skills/godot-csharp/` folder.

16. **Print summary** — List all created files with one-line descriptions. Print next steps: open the folder in Godot 4.x (.NET build), verify autoloads appear in Project Settings > Autoload, add a `CollisionShape2D` shape in the editor, add custom InputMap actions (`move_left`, `move_right`, `move_up`, `move_down`) in Project Settings > Input Map, and replace the placeholder TileMapLayer with actual tiles.
