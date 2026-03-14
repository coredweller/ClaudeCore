# Project Structure

Recommended directory organization for Godot 4.x C# projects.

## Standard Project Layout

```
project/
├── .godot/                  # Godot cache (gitignore)
├── addons/                  # Editor plugins and extensions
│   └── my_plugin/
├── assets/                  # Non-code resources
│   ├── audio/
│   │   ├── music/
│   │   └── sfx/
│   ├── fonts/
│   ├── sprites/
│   │   ├── characters/
│   │   ├── environment/
│   │   └── ui/
│   ├── textures/
│   └── themes/
├── autoloads/               # Global singletons (C# + .tscn stubs)
│   ├── GameManager.cs
│   ├── AudioManager.cs
│   └── SaveManager.cs
├── components/              # Reusable node components
│   ├── HealthComponent.cs
│   ├── HitboxComponent.cs
│   └── MovementComponent.cs
├── resources/               # Custom Resource definitions
│   ├── ItemData.cs
│   ├── CharacterStats.cs
│   └── DialogueData.cs
├── scenes/                  # Game scenes
│   ├── actors/              # Characters, enemies, NPCs
│   │   ├── player/
│   │   │   ├── Player.tscn
│   │   │   └── Player.cs
│   │   └── enemies/
│   ├── levels/              # Level/world scenes
│   │   ├── Level01.tscn
│   │   └── Level02.tscn
│   ├── objects/             # Interactive objects
│   │   ├── Door.tscn
│   │   └── Chest.tscn
│   └── ui/                  # UI scenes
│       ├── HUD.tscn
│       ├── MainMenu.tscn
│       └── PauseMenu.tscn
├── scripts/                 # Standalone scripts
│   ├── classes/             # Base classes
│   │   └── Actor.cs
│   └── utils/               # Utility functions
│       └── MathUtils.cs
├── shaders/                 # Shader files
│   └── Outline.gdshader
├── data/                    # Static data files (Resource instances)
│   ├── items/
│   └── enemies/
├── project.godot            # Project settings
├── MyGame.csproj            # .NET project file
├── MyGame.sln               # Solution file
├── export_presets.cfg       # Export configurations
└── .gitignore
```

## Directory Purposes

### addons/

Third-party and custom editor plugins. C# plugins use `[Tool]` attribute:

```csharp
#if TOOLS
[Tool]
public partial class MyPlugin : EditorPlugin
{
    public override void _EnterTree()
    {
        // Plugin initialization
    }

    public override void _ExitTree()
    {
        // Plugin cleanup
    }
}
#endif
```

### autoloads/

Global singletons registered in Project Settings > Autoload:
- Keep autoloads thin (services, not game logic)
- One responsibility per autoload
- Prefer signals over direct method calls

```csharp
// Good autoload: Manages audio globally
public partial class AudioManager : Node
{
    public void PlaySfx(AudioStream sound) { /* ... */ }
}

// Bad autoload: Too much game logic
public partial class GameManager : Node
{
    public int PlayerHealth { get; set; }  // Should be on Player
    public int CurrentLevel { get; set; }  // Should be on LevelManager
    public void SpawnEnemy() { }           // Should be on EnemySpawner
}
```

### components/

Reusable node scripts that can be attached to any scene:

```csharp
// HealthComponent.cs
public partial class HealthComponent : Node
{
    [Signal] public delegate void HealthChangedEventHandler(int current, int maximum);
    [Signal] public delegate void DiedEventHandler();

    [Export] public int MaxHealth { get; set; } = 100;

    public int CurrentHealth { get; private set; }

    public override void _Ready() => CurrentHealth = MaxHealth;

    public void TakeDamage(int amount)
    {
        CurrentHealth = Mathf.Max(0, CurrentHealth - amount);
        EmitSignal(SignalName.HealthChanged, CurrentHealth, MaxHealth);
        if (CurrentHealth <= 0)
            EmitSignal(SignalName.Died);
    }
}
```

### resources/

Custom Resource class definitions (not instances):

```csharp
// ItemData.cs
public partial class ItemData : Resource
{
    [Export] public string Id { get; set; } = "";
    [Export] public string DisplayName { get; set; } = "";
    [Export] public Texture2D Icon { get; set; }
    [Export] public int StackSize { get; set; } = 99;
    [Export(PropertyHint.MultilineText)] public string Description { get; set; } = "";
}
```

Resource instances go in `data/`:
```
data/
├── items/
│   ├── sword.tres       # ItemData instance
│   └── potion.tres
└── enemies/
    ├── slime.tres       # EnemyData instance
    └── goblin.tres
```

### scenes/

Organized by entity type, not by node type:

```
# Good: Organized by game entity
scenes/
├── actors/
│   └── player/
│       ├── Player.tscn
│       ├── Player.cs
│       └── player_states/

# Avoid: Organized by node type
scenes/
├── characterbody2d/
│   └── Player.tscn
├── area2d/
│   └── Hitbox.tscn
```

### scripts/

Scripts not attached to specific scenes:
- Base classes extended by scene scripts
- Utility functions (static classes)
- Data structures

```csharp
// scripts/classes/Actor.cs
/// <summary>Base class for all game characters.</summary>
public partial class Actor : CharacterBody2D
{
    [Signal] public delegate void DiedEventHandler();

    [Export] public float MoveSpeed { get; set; } = 100.0f;

    protected HealthComponent HealthComponent;

    public override void _Ready()
    {
        HealthComponent = GetNodeOrNull<HealthComponent>("HealthComponent");
        if (HealthComponent != null)
            HealthComponent.Died += OnDied;
    }

    protected virtual void OnDied() => QueueFree();
}
```

```csharp
// scripts/utils/MathUtils.cs
public static class MathUtils
{
    public static float Remap(float value, float fromMin, float fromMax, float toMin, float toMax)
        => toMin + (value - fromMin) / (fromMax - fromMin) * (toMax - toMin);

    public static Vector2 RandomDirection()
    {
        float angle = GD.Randf() * Mathf.Tau;
        return new Vector2(Mathf.Cos(angle), Mathf.Sin(angle));
    }
}
```

## Scene Organization Patterns

### Co-located Scripts

Keep script next to its scene:

```
scenes/actors/player/
├── Player.tscn
├── Player.cs            # Main player script
├── PlayerCamera.cs      # Camera control
└── PlayerAnimations.cs
```

### Nested Scenes

Break complex scenes into sub-scenes:

```
# Player.tscn contains:
Player (CharacterBody2D)
├── CollisionShape2D
├── Sprite2D
├── AnimationPlayer
├── WeaponMount (Node2D)
│   └── weapon.tscn (instanced)
├── HealthComponent (health_component.tscn)
└── StateMachine (Node)
    └── [states as child nodes]
```

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Folders | PascalCase or snake_case | `PlayerStates/` or `player_states/` |
| Scenes | PascalCase.tscn | `MainMenu.tscn` |
| C# Scripts | PascalCase.cs | `PlayerController.cs` |
| Resources | PascalCase.tres | `FireSword.tres` |
| Shaders | snake_case.gdshader | `water_ripple.gdshader` |
| Images | snake_case.png | `player_idle.png` |
| Audio | snake_case.wav/ogg | `jump_sound.wav` |

## Git Configuration

Recommended `.gitignore`:

```gitignore
# Godot cache
.godot/

# .NET build outputs
.vs/
bin/
obj/
*.user

# Exports
*.pck
*.zip
build/

# OS files
.DS_Store
Thumbs.db

# Editor backups
*.import.bak

# Rider / VS Code
.idea/
.vscode/
*.code-workspace
```

## .csproj Configuration

Minimal `.csproj` for Godot 4 C#:

```xml
<Project Sdk="Godot.NET.Sdk/4.x.x">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <EnableDynamicLoading>true</EnableDynamicLoading>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
</Project>
```

## Best Practices

1. **One scene, one responsibility** — Split complex scenes
2. **Co-locate related files** — Script next to scene
3. **Use Resources for data** — Not static C# classes with const values
4. **Avoid deep nesting** — Max 3-4 levels deep
5. **Consistent naming** — Same conventions everywhere
6. **Version control friendly** — Text-based resources (.tres not .res)
7. **Nullable enabled** — Catch null refs at compile time
