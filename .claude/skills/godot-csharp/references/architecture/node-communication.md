# Node Communication Patterns

Guide to communication between nodes in Godot 4.x C#.

## The Golden Rule

**Signal up, call down.**

- Parents know about children (can call their methods)
- Children don't know about parents (emit signals instead)
- Siblings communicate through shared parent or groups

## Signal-Driven Architecture

The canonical component pattern: child emits, parent connects.

```csharp
// HealthComponent.cs — child emits signals, never calls parent
public partial class HealthComponent : Node
{
    [Signal] public delegate void HealthChangedEventHandler(int current, int maximum);
    [Signal] public delegate void DiedEventHandler();

    [Export] public int MaxHealth { get; set; } = 100;

    private int _health;

    public override void _Ready() => _health = MaxHealth;

    public void TakeDamage(int amount)
    {
        _health = Mathf.Max(0, _health - amount);
        EmitSignal(SignalName.HealthChanged, _health, MaxHealth);
        if (_health <= 0)
            EmitSignal(SignalName.Died);
    }
}
```

```csharp
// Player.cs — parent connects to child signals
public partial class Player : CharacterBody2D
{
    private HealthComponent _health;
    private Sprite2D _sprite;

    public override void _Ready()
    {
        _health = GetNode<HealthComponent>("HealthComponent");
        _sprite = GetNode<Sprite2D>("Sprite2D");

        _health.HealthChanged += OnHealthChanged;
        _health.Died += OnDied;
    }

    private void OnHealthChanged(int current, int maximum) { /* update UI */ }

    private void OnDied()
    {
        _sprite.Modulate = Colors.Red;
        QueueFree();
    }
}
```

## Signal Naming

Use `SignalName` for type-safe emission. Prefer C# event syntax for connecting and disconnecting.

```csharp
// Define
[Signal] public delegate void ScoreUpdatedEventHandler(int newScore, int oldScore);

// Emit — use generated SignalName class, never a raw string
EmitSignal(SignalName.ScoreUpdated, newScore, oldScore);

// Connect — C# event syntax (preferred)
someNode.ScoreUpdated += OnScoreUpdated;

// Disconnect
someNode.ScoreUpdated -= OnScoreUpdated;

// Connect via Callable (use when you need to pass to Connect() directly)
someNode.Connect(Node.SignalName.TreeExited, Callable.From(OnNodeExited));
```

## Pattern 1: Signals (Decoupled Communication)

Best for: Events, state changes, child-to-parent communication.

```csharp
// InteractButton.cs — emits signal (doesn't know who listens)
public partial class InteractButton : Area2D
{
    [Signal] public delegate void PressedEventHandler();

    private void OnBodyEntered(Node2D body)
    {
        if (body.IsInGroup("player"))
            EmitSignal(SignalName.Pressed);
    }
}
```

```csharp
// Door.cs — connects to signal
public partial class Door : Node2D
{
    [Export] public NodePath ButtonPath { get; set; }
    private InteractButton _button;

    public override void _Ready()
    {
        _button = GetNodeOrNull<InteractButton>(ButtonPath);
        if (_button != null)
            _button.Pressed += OnButtonPressed;
    }

    private void OnButtonPressed() => Open();

    public void Open() { /* door opening logic */ }
}
```

### Typed Signals (Godot 4.x C#)

```csharp
// Define signals with typed parameters
[Signal] public delegate void HealthChangedEventHandler(int newHealth, int maxHealth);
[Signal] public delegate void ItemCollectedEventHandler(Item item, Node2D collector);
[Signal] public delegate void DamageDealtEventHandler(Node2D target, int amount, int damageType);

// Emit with correct types — use SignalName for type safety
EmitSignal(SignalName.HealthChanged, 50, 100);
EmitSignal(SignalName.ItemCollected, swordItem, player);

// Connect using C# event syntax (preferred)
healthComponent.HealthChanged += OnHealthChanged;
healthComponent.HealthChanged -= OnHealthChanged; // Disconnect
```

### Awaiting Signals (One-Time Use)

```csharp
// Wait for animation to finish
await ToSignal(_animationPlayer, AnimationPlayer.SignalName.AnimationFinished);

// Wait for timer
await ToSignal(GetTree().CreateTimer(1.0f), SceneTreeTimer.SignalName.Timeout);

// Wait for custom signal
await ToSignal(someNode, InteractButton.SignalName.Pressed);
```

## Pattern 2: Direct Method Calls (Parent to Child)

Best for: Commands, immediate actions, when relationship is known.

```csharp
// Player.cs — calls child methods directly
public partial class Player : CharacterBody2D
{
    private Weapon _weapon;
    private AnimationPlayer _animator;
    private HealthComponent _health;

    public override void _Ready()
    {
        _weapon = GetNode<Weapon>("Weapon");
        _animator = GetNode<AnimationPlayer>("AnimationPlayer");
        _health = GetNode<HealthComponent>("HealthComponent");
    }

    public void Attack()
    {
        _weapon.Fire();           // Direct call to child
        _animator.Play("attack"); // Direct call to child
    }

    public void TakeDamage(int amount)
    {
        _health.Damage(amount);   // Direct call to child
    }
}
```

### Safe Access with Optional Nodes

```csharp
// Node might not exist in all scene variations
private Shield _optionalShield;

public override void _Ready()
{
    _optionalShield = GetNodeOrNull<Shield>("Shield");
}

public void Block()
{
    _optionalShield?.Activate();
}
```

## Pattern 3: Groups (Cross-Scene Communication)

Best for: Finding nodes across scene boundaries, one-to-many communication.

```csharp
// Add to groups in _Ready() or the editor
public override void _Ready()
{
    AddToGroup("enemies");
    AddToGroup("damageable");
}
```

```csharp
// Explosion.cs — affects all nodes in group
public void Explode()
{
    var blastPos = GlobalPosition;

    foreach (Node node in GetTree().GetNodesInGroup("damageable"))
    {
        if (node is Node2D node2D)
        {
            float distance = node2D.GlobalPosition.DistanceTo(blastPos);
            if (distance < BlastRadius)
            {
                int damage = CalculateFalloffDamage(distance);
                if (node2D.HasMethod("TakeDamage"))
                    node2D.Call("TakeDamage", damage);
            }
        }
    }
}
```

### Scene-Specific Groups

Prefix groups with scene identifier for isolation:

```csharp
// In level_01
public override void _Ready() => AddToGroup("level_01_enemies");

public override void _ExitTree()
{
    GetTree().CallGroup("level_01_enemies", Node.MethodName.QueueFree);
}
```

## Pattern 4: Autoloads (Global State)

Best for: Services, managers, truly global state.

```csharp
// EventBus.cs — global event system (autoload)
public partial class EventBus : Node
{
    [Signal] public delegate void PlayerDiedEventHandler();
    [Signal] public delegate void LevelCompletedEventHandler(string levelName);
    [Signal] public delegate void AchievementUnlockedEventHandler(string achievementId);

    // Any node can emit:
    // EventBus.EmitSignal(EventBus.SignalName.PlayerDied);

    // Any node can connect:
    // EventBus.PlayerDied += OnPlayerDied;
}
```

Access an autoload from any node:

```csharp
// From any node
private EventBus _eventBus;

public override void _Ready()
{
    _eventBus = GetNode<EventBus>("/root/EventBus");
    _eventBus.PlayerDied += OnPlayerDied;
}
```

### When to Use Autoloads

| Use Case | Autoload? | Why |
|----------|-----------|-----|
| Audio playback | Yes | Persists between scenes |
| Save/load | Yes | Global service |
| Player stats | Maybe | Consider level-owned |
| Score | Maybe | Consider game state resource |
| Level manager | No | Scene should manage itself |
| Enemy spawning | No | Level-specific logic |

## Pattern 5: Dependency Injection

Pass dependencies instead of hardcoding:

```csharp
// Weapon.cs — receives owner stats, doesn't find them
public partial class Weapon : Node2D
{
    private CharacterStats _ownerStats;

    public void Setup(CharacterStats stats)
    {
        _ownerStats = stats;
    }

    public int CalculateDamage()
        => BaseDamage + _ownerStats.Strength;
}
```

```csharp
// Player.cs — injects dependency
public override void _Ready()
{
    GetNode<Weapon>("Weapon").Setup(_stats);
}
```

## Pattern 6: Callable / Lambda

Pass behavior as a parameter:

```csharp
// TimerUtils.cs
public static class TimerUtils
{
    public static async void DelayedCall(Node node, float delay, Action callback)
    {
        await node.ToSignal(node.GetTree().CreateTimer(delay), SceneTreeTimer.SignalName.Timeout);
        callback();
    }
}

// Usage
TimerUtils.DelayedCall(this, 2.0f, () => GD.Print("2 seconds later"));
TimerUtils.DelayedCall(this, 1.0f, QueueFree);
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: GetParent() Chains

```csharp
// Bad: Fragile, breaks on refactor
var player = GetParent().GetParent().GetParent() as Player;

// Good: Use groups or signals
var player = GetTree().GetFirstNodeInGroup("player") as Player;
```

### Anti-Pattern 2: Global FindChild()

```csharp
// Bad: Searches entire tree, slow and fragile
var enemy = GetTree().Root.FindChild("Enemy", true, false);

// Good: Use groups or explicit references
var enemies = GetTree().GetNodesInGroup("enemies");
```

### Anti-Pattern 3: Bidirectional References

```csharp
// Bad: Circular reference, unclear ownership
// In Player.cs:  public Weapon CurrentWeapon;
// In Weapon.cs:  public Player OwnerPlayer;

// Good: Parent references child, child signals parent
// In Player.cs:  private Weapon _weapon;
// In Weapon.cs:  [Signal] public delegate void AmmoDepleted... // Player connects
```

### Anti-Pattern 4: String-Based Signals (Legacy)

```csharp
// Bad: No type safety, typo-prone (old style)
Connect("health_changed", new Callable(this, "_on_health_changed"));
EmitSignal("health_changed", 50);

// Good: C# event syntax (preferred in Godot 4 C#)
healthComponent.HealthChanged += OnHealthChanged;
EmitSignal(SignalName.HealthChanged, 50, 100);
```

## Decision Guide

| Scenario | Pattern |
|----------|---------|
| Child notifies parent of state change | Signal |
| Parent commands child to act | Direct call |
| Siblings need to communicate | Signal through parent or group |
| Any node to any node | Group or autoload event bus |
| Waiting for something to happen | `await ToSignal(...)` |
| Global service (audio, saves) | Autoload |
| Need to find multiple nodes | Groups |
| Node needs external configuration | Dependency injection |

## Performance Considerations

1. **Signals are fast** — Don't avoid them for performance
2. **Groups are cached** — `GetNodesInGroup()` is efficient
3. **Avoid per-frame group queries** — Cache references in `_Ready()`
4. **Direct calls are fastest** — Use when relationship is stable

```csharp
// Cache group results if queried frequently
private Godot.Collections.Array<Node> _cachedEnemies;

public override void _Ready()
{
    _cachedEnemies = GetTree().GetNodesInGroup("enemies");
    GetTree().NodeAdded += OnNodeAdded;
    GetTree().NodeRemoved += OnNodeRemoved;
}

private void OnNodeAdded(Node node)
{
    if (node.IsInGroup("enemies"))
        _cachedEnemies.Add(node);
}
```
