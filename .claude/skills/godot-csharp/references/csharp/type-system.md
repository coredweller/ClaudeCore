# C# Type System in Godot 4.x

Deep dive into how C# types map to Godot's type system and API.

## Naming Conventions

```csharp
// Classes: PascalCase
public partial class PlayerController : CharacterBody2D
{
    // Signals: PascalCase delegate with [Signal] attribute; name ends in EventHandler
    [Signal] public delegate void HealthChangedEventHandler(int newHealth);
    [Signal] public delegate void PlayerDiedEventHandler();
    [Signal] public delegate void ItemCollectedEventHandler(Item item);

    // Constants: PascalCase (SCREAMING_SNAKE_CASE is also accepted)
    private const float MaxSpeed = 200.0f;
    private const int JumpForce = -400;

    // Public properties: PascalCase
    public int CurrentHealth { get; private set; } = 100;

    // Private fields: _camelCase (leading underscore)
    private float _speed = 100.0f;
    private bool _isGrounded;

    // Methods (public and private): PascalCase
    public int CalculateDamage(int baseDamage, float multiplier) => (int)(baseDamage * multiplier);
    private void UpdateAnimation() { }
}
```

## Partial Classes

All Godot node scripts **must** use `partial class`. The Godot source generator requires it to wire up `[Signal]` and `[Export]` attributes at compile time.

```csharp
// REQUIRED
public partial class Player : CharacterBody2D
{
    // Source generator wires [Signal] and [Export] here
}

// WRONG — breaks signal/export wiring entirely
public class Player : CharacterBody2D { }
```

## Godot Type Mappings

| GDScript Type | C# Type | Notes |
|---------------|---------|-------|
| `int` | `int` (or `long`) | Godot uses 64-bit internally |
| `float` | `float` (or `double`) | Use `float` for most game math |
| `String` | `string` | C# string maps to Godot String |
| `StringName` | `StringName` | Interned string — use for signal/method names |
| `bool` | `bool` | |
| `Vector2` | `Vector2` | Godot struct |
| `Vector3` | `Vector3` | Godot struct |
| `Color` | `Color` | Godot struct |
| `Rect2` | `Rect2` | Godot struct |
| `Array` | `Godot.Collections.Array` | Untyped |
| `Array[T]` | `Godot.Collections.Array<T>` | Typed Godot array |
| `Dictionary` | `Godot.Collections.Dictionary` | |
| `Callable` | `Callable` | Wraps method references |
| `NodePath` | `NodePath` | Path to a node |
| `PackedScene` | `PackedScene` | |
| `Variant` | `Variant` | Any Godot type — avoid when possible |

## Nullable Reference Types

Enable nullable in `.csproj` to catch null reference errors at compile time:

```xml
<PropertyGroup>
  <Nullable>enable</Nullable>
</PropertyGroup>
```

```csharp
// Non-nullable: must be assigned
private Sprite2D _sprite = null!; // Suppress warning — assigned in _Ready

// Nullable: may be null
private Shield? _optionalShield;

public override void _Ready()
{
    _sprite = GetNode<Sprite2D>("Sprite2D");           // Always exists
    _optionalShield = GetNodeOrNull<Shield>("Shield"); // May not exist
}

public void Block()
{
    _optionalShield?.Activate(); // Safe null-conditional
}
```

## StringName Performance

Use `StringName` for frequently-compared strings (signal names, group names, animation names):

```csharp
// Bad: allocates new string every call
_animationPlayer.Play("idle");

// Good: StringName literals are interned (compared by reference)
private static readonly StringName IdleAnim = "idle";
private static readonly StringName WalkAnim = "walk";

_animationPlayer.Play(IdleAnim);

// Signal names via generated SignalName class (always prefer this)
EmitSignal(SignalName.HealthChanged, _health, _maxHealth);
GetTree().NodeAdded += OnNodeAdded;
```

## Variant and GodotObject

Avoid `Variant` where possible — use typed alternatives:

```csharp
// Avoid: loses type safety
Variant result = someNode.Get("property");
object value = result.As<int>();

// Prefer: typed property access when you know the type
int health = (int)someNode.Get("health");

// For dynamic interop with GDScript, Variant is sometimes unavoidable
public void SetProperty(string name, Variant value)
    => Set(name, value);
```

## Collections

Use typed Godot collections for interop with the engine:

```csharp
// Godot.Collections.Array<T> — for engine interop
[Export] public Godot.Collections.Array<PackedScene> EnemyScenes { get; set; } = new();

// System.Collections.Generic.List<T> — for pure C# logic
private readonly List<Enemy> _activeEnemies = new();

// Convert between them when needed
var godotArray = new Godot.Collections.Array<string>(_myList);
var netList = new List<string>(_myGodotArray);
```

## Enums

C# enums work naturally with Godot exports:

```csharp
public enum Difficulty { Easy, Normal, Hard }
public enum DamageType { Physical, Fire, Ice, Lightning }

// Export enum — shows as dropdown in editor
[Export] public Difficulty GameDifficulty { get; set; } = Difficulty.Normal;

// Flags enum — shows as bitmask in editor
[Flags]
public enum Element { None = 0, Fire = 1, Water = 2, Earth = 4, Air = 8 }
[Export] public Element WeaponElements { get; set; } = Element.None;

// Using enums in signals
[Signal] public delegate void DifficultyChangedEventHandler(Difficulty newDifficulty);
```

## Generics with Godot

Use generics for type-safe node access and scene instantiation:

```csharp
// Typed node access — assign in _Ready(), not as field initializers
// (GetNode requires 'this' and cannot be called at field initialisation time)
private Player _player;
private HealthComponent _health;

public override void _Ready()
{
    _player = GetNode<Player>("%Player");
    _health = GetNodeOrNull<HealthComponent>("HealthComponent");
}

// Typed scene instantiation — avoids casting
private static readonly PackedScene BulletScene =
    GD.Load<PackedScene>("res://scenes/Bullet.tscn");

public Bullet SpawnBullet() => BulletScene.Instantiate<Bullet>();

// Generic resource loading
private static readonly ItemData SwordData =
    GD.Load<ItemData>("res://data/items/sword.tres");
```

## Structs vs Classes

Godot math types (`Vector2`, `Color`, etc.) are C# **structs** — they are value types:

```csharp
// Structs are copied on assignment — this doesn't modify the original
var pos = GlobalPosition;    // copies the Vector2
pos.X += 10;                 // modifies the copy
// GlobalPosition is unchanged!

// Correct: assign back
var pos = GlobalPosition;
pos.X += 10;
GlobalPosition = pos;

// Or: use with-expression (C# 9+)
GlobalPosition = GlobalPosition with { X = GlobalPosition.X + 10 };

// Velocity modification — same pattern
var vel = Velocity;
vel.X = Input.GetAxis("move_left", "move_right") * MoveSpeed;
Velocity = vel;
```

## RefCounted vs GodotObject

- `RefCounted`: automatic memory management (use for pure data objects)
- `GodotObject`: manual memory or tree-managed (for nodes)

```csharp
// RefCounted — automatically freed when no references remain
public partial class SaveData : Resource  // Resource extends RefCounted
{
    [Export] public int Level { get; set; }
}

// GodotObject — must be added to scene tree or freed manually
var node = new Node2D();
AddChild(node);   // Tree manages lifetime
// OR
node.Free();      // Manual free (use QueueFree() in most cases)

// QueueFree() is safe — deferred until end of frame
public void Die() => QueueFree();
```

## Properties vs Fields in Exports

`[Export]` works on both properties and fields, but properties with `get; set;` are preferred:

```csharp
// Preferred: property with backing (allows validation)
private float _moveSpeed = 200.0f;
[Export]
public float MoveSpeed
{
    get => _moveSpeed;
    set => _moveSpeed = Mathf.Max(0, value); // Validate in setter
}

// Also valid: auto-property (simpler, no validation)
[Export] public int MaxHealth { get; set; } = 100;

// Field — works but loses property benefits
[Export] public float JumpForce = -400.0f; // Avoid: no encapsulation
```

## is / as Pattern

Use `is` for type checking and `as` for safe casting:

```csharp
// Type check + cast in one step (pattern matching)
if (body is Player player)
{
    player.TakeDamage(10);
}

// Safe cast — returns null if fails
var enemy = node as Enemy;
if (enemy != null)
    enemy.Alert();

// Switch expression with patterns
string description = node switch
{
    Player p  => $"Player with {p.CurrentHealth} HP",
    Enemy e   => $"Enemy: {e.Name}",
    _         => "Unknown entity"
};
```
