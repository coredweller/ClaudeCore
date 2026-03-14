# Scene Composition Patterns

Guide to designing and organizing Godot scenes for maintainability and reusability in C#.

## Core Principles

1. **Scenes as prefabs** — Reusable, self-contained units
2. **Composition over inheritance** — Combine small scenes, don't extend large ones
3. **Single responsibility** — Each scene does one thing well
4. **Loose coupling** — Scenes communicate through signals

## Exports and Node References

Use `[Export]` for editor-configurable values. Group them with `[ExportGroup]`. Always fetch node references in `_Ready()` — never in `_Process()`.

```csharp
public partial class Player : CharacterBody2D
{
    // Basic exports
    [Export] public float MoveSpeed { get; set; } = 200.0f;
    [Export] public int MaxHealth { get; set; } = 100;
    [Export] public PackedScene BulletScene { get; set; }

    // Export groups — shown as collapsible sections in the Godot inspector
    [ExportGroup("Combat")]
    [Export] public int AttackDamage { get; set; } = 10;
    [Export] public float AttackRange { get; set; } = 50.0f;

    [ExportGroup("Movement")]
    [Export] public float JumpForce { get; set; } = -400.0f;

    // Constrained ranges
    [Export(PropertyHint.Range, "0,100")] public int Percentage { get; set; } = 50;
    [Export(PropertyHint.Range, "0.0,1.0,0.1")] public float Volume { get; set; } = 0.8f;

    // Node references — declared as fields, fetched once in _Ready
    private Sprite2D _sprite;
    private CollisionShape2D _collision;
    private AnimationPlayer _animationPlayer;

    public override void _Ready()
    {
        _sprite = GetNode<Sprite2D>("Sprite2D");
        _collision = GetNode<CollisionShape2D>("CollisionShape2D");
        _animationPlayer = GetNode<AnimationPlayer>("AnimationPlayer");

        // %UniqueName — stable regardless of hierarchy depth
        var healthBar = GetNode<ProgressBar>("%HealthBar");
    }
}
```

## Resource Loading

Cache `GD.Load<T>()` in `static readonly` fields — loading from disk inside `_Process` causes stuttering. Use `PackedScene.Instantiate<T>()` for type-safe scene instantiation. Use `ResourceLoader.LoadThreadedRequest` for non-blocking async loads.

```csharp
// Static field — loaded once when the class is first used
private static readonly PackedScene BulletScene =
    GD.Load<PackedScene>("res://scenes/Bullet.tscn");

private static readonly ItemData SwordData =
    GD.Load<ItemData>("res://data/items/sword.tres");

// Typed instantiation — no cast required
private Bullet SpawnBullet() => BulletScene.Instantiate<Bullet>();

// Async loading — prevents frame stutter for large scenes
public void LoadLevelAsync(string path)
{
    ResourceLoader.LoadThreadedRequest(path);
    // Poll: ResourceLoader.LoadThreadedGetStatus(path)
    // Retrieve: ResourceLoader.LoadThreadedGet(path) as PackedScene
}
```

## Pattern 1: Component Composition

Build complex entities from simple component scenes:

```
# Entity composed of components
Player.tscn
├── CharacterBody2D (Player.cs)
│   ├── Sprite2D
│   ├── CollisionShape2D
│   ├── AnimationPlayer
│   ├── HealthComponent (HealthComponent.tscn)
│   ├── HitboxComponent (HitboxComponent.tscn)
│   ├── MovementComponent (MovementComponent.tscn)
│   └── InventoryComponent (InventoryComponent.tscn)
```

```csharp
// Player.cs — orchestrates components
public partial class Player : CharacterBody2D
{
    private HealthComponent _health;
    private HitboxComponent _hitbox;
    private MovementComponent _movement;

    public override void _Ready()
    {
        _health = GetNode<HealthComponent>("HealthComponent");
        _hitbox = GetNode<HitboxComponent>("HitboxComponent");
        _movement = GetNode<MovementComponent>("MovementComponent");

        _health.Died += OnDied;
        _hitbox.HitReceived += _health.TakeDamage;
    }

    public override void _PhysicsProcess(double delta)
    {
        var inputDir = Input.GetVector("left", "right", "up", "down");
        _movement.Move(inputDir, delta);
        MoveAndSlide();
    }

    private void OnDied() => QueueFree();
}
```

```csharp
// HealthComponent.cs — reusable component
public partial class HealthComponent : Node
{
    [Signal] public delegate void HealthChangedEventHandler(int current, int maximum);
    [Signal] public delegate void DiedEventHandler();

    [Export] public int MaxHealth { get; set; } = 100;

    private int _currentHealth;
    public int CurrentHealth
    {
        get => _currentHealth;
        private set
        {
            _currentHealth = Mathf.Clamp(value, 0, MaxHealth);
            EmitSignal(SignalName.HealthChanged, _currentHealth, MaxHealth);
            if (_currentHealth <= 0)
                EmitSignal(SignalName.Died);
        }
    }

    public override void _Ready() => _currentHealth = MaxHealth;

    public void TakeDamage(int amount) => CurrentHealth -= amount;
    public void Heal(int amount) => CurrentHealth += amount;
}
```

## Pattern 2: Scene Inheritance

Extend base scenes for variations:

```
# Base enemy scene
EnemyBase.tscn
├── CharacterBody2D (EnemyBase.cs)
│   ├── Sprite2D
│   ├── CollisionShape2D
│   ├── HealthComponent
│   └── NavigationAgent2D

# Inherited scenes override properties
Slime.tscn (inherits EnemyBase.tscn)
├── [Sprite2D with slime texture]
├── [CollisionShape2D resized]
└── Slime.cs (extends EnemyBase)

Goblin.tscn (inherits EnemyBase.tscn)
├── [Sprite2D with goblin texture]
├── WeaponMount (added node)
└── Goblin.cs (extends EnemyBase)
```

```csharp
// EnemyBase.cs
public partial class EnemyBase : CharacterBody2D
{
    [Export] public float MoveSpeed { get; set; } = 50.0f;
    [Export] public int Damage { get; set; } = 10;

    protected NavigationAgent2D NavAgent;
    protected HealthComponent Health;

    public override void _Ready()
    {
        NavAgent = GetNode<NavigationAgent2D>("NavigationAgent2D");
        Health = GetNode<HealthComponent>("HealthComponent");
        Health.Died += OnDied;
    }

    public override void _PhysicsProcess(double delta) => MoveTowardTarget(delta);

    protected virtual void MoveTowardTarget(double delta) { }

    protected virtual void OnDied() => QueueFree();
}
```

```csharp
// Slime.cs — extends base with specific behavior
public partial class Slime : EnemyBase
{
    [Export] public int SplitCount { get; set; } = 2;
    [Export] public PackedScene SmallSlimeScene { get; set; }

    protected override void OnDied()
    {
        SpawnSmallerSlimes();
        base.OnDied();
    }

    private void SpawnSmallerSlimes()
    {
        if (SplitCount <= 0 || SmallSlimeScene == null) return;
        for (int i = 0; i < SplitCount; i++)
        {
            var slime = SmallSlimeScene.Instantiate<Slime>();
            GetParent().AddChild(slime);
            slime.GlobalPosition = GlobalPosition;
        }
    }
}
```

## Pattern 3: Container Scenes

Scenes that manage child scenes dynamically:

```csharp
// Level.cs — container that loads/manages sub-scenes
public partial class Level : Node2D
{
    [Export] public Godot.Collections.Array<PackedScene> EnemySpawns { get; set; } = new();

    private Node2D _enemyContainer;
    private Node2D _pickupContainer;

    public override void _Ready()
    {
        _enemyContainer = GetNode<Node2D>("Enemies");
        _pickupContainer = GetNode<Node2D>("Pickups");
        SpawnEnemies();
    }

    private void SpawnEnemies()
    {
        if (EnemySpawns.Count == 0) return;

        foreach (Node spawnPoint in GetNode("SpawnPoints").GetChildren())
        {
            if (spawnPoint is not Node2D sp) continue;
            int idx = GD.RandRange(0, EnemySpawns.Count - 1);
            var enemy = EnemySpawns[idx].Instantiate<Node2D>();
            enemy.Position = sp.Position;
            _enemyContainer.AddChild(enemy);
        }
    }

    public void AddPickup(Node2D pickup, Vector2 position)
    {
        pickup.Position = position;
        _pickupContainer.AddChild(pickup);
    }
}
```

## Pattern 4: Owner Access

Child scenes can access their owner for context:

```csharp
// Weapon.cs — attached to Weapon.tscn, instanced in player
public partial class Weapon : Node2D
{
    private CharacterBody2D _wielder;

    public override void _Ready()
    {
        _wielder = Owner as CharacterBody2D;
        if (_wielder == null)
            GD.PushError("Weapon must be child of CharacterBody2D");
    }

    public void Attack()
    {
        if (_wielder == null) return;
        var direction = _wielder.GlobalTransform.X;
        // Use wielder's position, stats, etc.
    }
}
```

## Pattern 5: Unique Names

Use `%` for stable references to important nodes:

```
Player.tscn
├── CharacterBody2D
│   ├── %Sprite (unique name)
│   ├── %AnimationPlayer (unique name)
│   ├── UI
│   │   └── %HealthBar (unique name)
│   └── Weapons
│       └── %CurrentWeapon (unique name)
```

```csharp
// Access via % regardless of hierarchy
private Sprite2D _sprite;
private AnimationPlayer _anim;
private ProgressBar _healthBar;
private Weapon _weapon;

public override void _Ready()
{
    _sprite = GetNode<Sprite2D>("%Sprite");
    _anim = GetNode<AnimationPlayer>("%AnimationPlayer");
    _healthBar = GetNode<ProgressBar>("%HealthBar");
    _weapon = GetNode<Weapon>("%CurrentWeapon");

    // Works even if UI node is renamed or moved
}
```

## Scene Communication Patterns

### Signals (Preferred)

```csharp
// Child emits, parent connects
// HealthComponent.cs
[Signal] public delegate void HealthChangedEventHandler(int current, int max);

// Player.cs
public override void _Ready()
{
    GetNode<HealthComponent>("HealthComponent").HealthChanged += UpdateHealthBar;
}
```

### Direct Calls (When Appropriate)

```csharp
// Parent calls child methods (knows about children)
public void Attack()
{
    GetNode<Weapon>("Weapon").Fire();
    GetNode<AnimationPlayer>("AnimationPlayer").Play("attack");
}
```

### Groups (Cross-Scene Communication)

```csharp
// Any node can find others in same group
public void OnExplosion()
{
    foreach (var node in GetTree().GetNodesInGroup("enemies"))
    {
        if (node is Node2D enemy &&
            enemy.GlobalPosition.DistanceTo(Position) < BlastRadius)
        {
            enemy.Call("TakeDamage", Damage);
        }
    }
}
```

## Scene Checklist

Before creating a new scene:

- [ ] Can it be reused elsewhere?
- [ ] Does it have a single responsibility?
- [ ] Are dependencies injected (not hardcoded)?
- [ ] Does it communicate via signals?
- [ ] Is the root node type appropriate?
- [ ] Are exported properties documented with XML `<summary>`?

## Common Mistakes

| Mistake | Problem | Solution |
|---------|---------|----------|
| Deep node paths | Fragile to refactoring | Use `%UniqueName` |
| Direct parent access | Tight coupling | Use signals |
| God scenes | Hard to maintain | Split into components |
| Missing null checks | Crashes | Use `GetNodeOrNull<T>()` |
| Circular references | Memory leaks | Weak references or signals |
| Forgetting `partial` | Signals/exports break | Always `partial class` |

## Best Practices

1. **Start simple, add complexity** — Don't over-engineer upfront
2. **Test scenes in isolation** — Each scene should work alone
3. **Document public API** — XML `<summary>` for signals/methods used externally
4. **Use tool mode for preview** — `[Tool]` attribute on scripts shows effects in editor
5. **Keep scene tree shallow** — Avoid deeply nested hierarchies
6. **Typed instantiation** — Use `PackedScene.Instantiate<T>()` for type safety
