# Object Pooling Patterns

Complete guide to implementing object pools in Godot 4.x C# for performance optimization.

## When to Use Object Pooling

Use pooling when:
- Frequently spawning/despawning objects (bullets, particles, enemies)
- Instantiation causes noticeable stuttering
- Objects have expensive initialization
- Same object types are reused throughout gameplay

Don't use pooling when:
- Objects are spawned rarely
- Each instance needs unique setup
- Memory is more constrained than CPU
- Prototype/early development (premature optimization)

## Pattern 1: Simple Pool

Basic pool for a single object type:

```csharp
public partial class SimplePool : Node
{
    [Export] public PackedScene PooledScene { get; set; }
    [Export] public int InitialSize { get; set; } = 20;
    [Export] public int MaxSize { get; set; } = 100;

    protected readonly List<Node> _available = new();
    protected readonly List<Node> _inUse = new();

    public override void _Ready() => WarmPool();

    private void WarmPool()
    {
        for (int i = 0; i < InitialSize; i++)
            _available.Add(CreateInstance());
    }

    private Node CreateInstance()
    {
        var obj = PooledScene.Instantiate();
        obj.SetProcess(false);
        AddChild(obj);

        // Auto-release if object is a Poolable — connect via SignalName for type safety
        if (obj is Poolable poolable)
            poolable.Finished += () => Release(obj);

        return obj;
    }

    public Node Acquire()
    {
        Node obj;

        if (_available.Count == 0)
        {
            if (_inUse.Count >= MaxSize)
            {
                GD.PushWarning($"Pool exhausted: {PooledScene.ResourcePath}");
                return null; // Intentional: returning null on exhaustion is standard game-dev practice.
                             // Callers must guard: if (bullet == null) return;
            }
            obj = CreateInstance();
        }
        else
        {
            obj = _available[^1];
            _available.RemoveAt(_available.Count - 1);
        }

        obj.SetProcess(true);
        (obj as CanvasItem)?.Show();
        _inUse.Add(obj);

        if (obj.HasMethod("Reset"))
            obj.Call("Reset");

        return obj;
    }

    public T Acquire<T>() where T : Node => Acquire() as T;

    public void Release(Node obj)
    {
        if (!_inUse.Contains(obj))
        {
            GD.PushWarning("Releasing object not from this pool");
            return;
        }

        _inUse.Remove(obj);
        obj.SetProcess(false);
        (obj as CanvasItem)?.Hide();
        _available.Add(obj);
    }

    public (int Available, int InUse, int Total) GetStats()
        => (_available.Count, _inUse.Count, _available.Count + _inUse.Count);

    protected int GetAvailableCount() => _available.Count;
    protected int GetInUseCount() => _inUse.Count;
    protected int GetTotalCount() => _available.Count + _inUse.Count;

    protected void RemoveOneAvailable()
    {
        if (_available.Count == 0) return;
        var obj = _available[^1];
        _available.RemoveAt(_available.Count - 1);
        obj.QueueFree();
    }
}
```

## Pattern 2: Pool Manager (Autoload)

Central manager for multiple pool types:

```csharp
// PoolManager.cs — autoload singleton
public partial class PoolManager : Node
{
    private readonly Dictionary<string, SimplePool> _pools = new();

    public void RegisterPool(PackedScene scene, int initialSize = 20, int maxSize = 100)
    {
        var path = scene.ResourcePath;
        if (_pools.ContainsKey(path))
        {
            GD.PushWarning($"Pool already registered: {path}");
            return;
        }

        var pool = new SimplePool
        {
            PooledScene = scene,
            InitialSize = initialSize,
            MaxSize = maxSize,
            Name = System.IO.Path.GetFileNameWithoutExtension(path) + "_Pool"
        };
        AddChild(pool);
        _pools[path] = pool;
    }

    public Node Acquire(PackedScene scene)
    {
        if (!_pools.TryGetValue(scene.ResourcePath, out var pool))
        {
            GD.PushError($"Pool not registered: {scene.ResourcePath}");
            return null;
        }
        return pool.Acquire();
    }

    public T Acquire<T>(PackedScene scene) where T : Node => Acquire(scene) as T;

    public void Release(PackedScene scene, Node obj)
    {
        if (!_pools.TryGetValue(scene.ResourcePath, out var pool))
        {
            GD.PushError($"Pool not registered: {scene.ResourcePath}");
            return;
        }
        pool.Release(obj);
    }

    public SimplePool GetPool(PackedScene scene)
        => _pools.GetValueOrDefault(scene.ResourcePath);

    public void ClearAll()
    {
        foreach (var pool in _pools.Values)
            pool.QueueFree();
        _pools.Clear();
    }
}
```

**Usage:**

```csharp
private static readonly PackedScene BulletScene =
    GD.Load<PackedScene>("res://scenes/Bullet.tscn");
private static readonly PackedScene EnemyScene =
    GD.Load<PackedScene>("res://scenes/Enemy.tscn");

// In game initialization
public override void _Ready()
{
    var poolManager = GetNode<PoolManager>("/root/PoolManager");
    poolManager.RegisterPool(BulletScene, 50, 200);
    poolManager.RegisterPool(EnemyScene, 10, 50);
}

// When spawning
public void FireBullet(Vector2 position, Vector2 direction)
{
    var bullet = _poolManager.Acquire<Bullet>(BulletScene);
    if (bullet == null) return;
    bullet.GlobalPosition = position;
    bullet.Direction = direction;
    bullet.Activate();
}
```

## Pattern 3: Poolable Interface

Standard interface for pooled objects:

```csharp
// Poolable.cs — base class for pooled objects
public partial class Poolable : Node
{
    [Signal] public delegate void FinishedEventHandler();

    /// <summary>Called when acquired from pool. Reset all state here.</summary>
    public virtual void Reset() { }

    /// <summary>Call to return this object to the pool.</summary>
    protected void Finish() => EmitSignal(SignalName.Finished);
}
```

```csharp
// Bullet.cs — example poolable object
public partial class Bullet : Poolable
{
    [Export] public float Speed { get; set; } = 500.0f;
    [Export] public float Lifetime { get; set; } = 2.0f;

    public Vector2 Direction { get; set; } = Vector2.Right;
    private float _timer;
    private CollisionShape2D _collision;

    public override void _Ready()
    {
        _collision = GetNode<CollisionShape2D>("CollisionShape2D");
    }

    public override void Reset()
    {
        _timer = 0.0f;
        Direction = Vector2.Right;
        _collision.Disabled = false;
    }

    public void Activate()
    {
        Show();
        SetPhysicsProcess(true);
    }

    public override void _PhysicsProcess(double delta)
    {
        Position += Direction * Speed * (float)delta;
        _timer += (float)delta;
        if (_timer >= Lifetime)
            Deactivate();
    }

    private void OnBodyEntered(Node2D body) => Deactivate();

    private void Deactivate()
    {
        _collision.Disabled = true;
        Hide();
        SetPhysicsProcess(false);
        Finish(); // Signal pool to reclaim this object
    }
}
```

## Pattern 4: Generic Typed Pool

Type-safe pool using C# generics:

```csharp
public partial class TypedPool<T> : Node where T : Node
{
    private readonly List<T> _available = new();
    private PackedScene _scene;

    public void Initialize(PackedScene scene, int initialSize = 10)
    {
        _scene = scene;
        for (int i = 0; i < initialSize; i++)
            _available.Add(CreateInstance());
    }

    private T CreateInstance()
    {
        var obj = _scene.Instantiate<T>();
        obj.SetProcess(false);
        AddChild(obj);
        return obj;
    }

    public T Acquire()
    {
        T obj;
        if (_available.Count == 0)
        {
            obj = CreateInstance();
        }
        else
        {
            obj = _available[^1];
            _available.RemoveAt(_available.Count - 1);
        }
        obj.SetProcess(true);
        (obj as CanvasItem)?.Show();
        return obj;
    }

    public void Release(T obj)
    {
        obj.SetProcess(false);
        (obj as CanvasItem)?.Hide();
        _available.Add(obj);
    }
}
```

## Pool Sizing Strategies

```csharp
public partial class AdaptivePool : SimplePool
{
    [Export] public float GrowthRate { get; set; } = 1.5f;
    [Export] public float ShrinkThreshold { get; set; } = 0.25f;
    [Export] public float ShrinkDelay { get; set; } = 30.0f;

    private float _shrinkTimer;
    private int _peakUsage;

    public override void _Process(double delta)
    {
        TrackUsage((float)delta);
    }

    private void TrackUsage(float delta)
    {
        // Note: Access _inUse from base or expose via property
        // This requires exposing count from SimplePool
        int inUse = GetInUseCount();
        _peakUsage = Mathf.Max(_peakUsage, inUse);

        int total = GetTotalCount();
        float ratio = total > 0 ? (float)inUse / total : 0f;

        if (ratio < ShrinkThreshold)
        {
            _shrinkTimer += delta;
            if (_shrinkTimer >= ShrinkDelay)
            {
                ShrinkPool();
                _shrinkTimer = 0;
            }
        }
        else
        {
            _shrinkTimer = 0;
        }
    }

    private void ShrinkPool()
    {
        int target = Mathf.Max(InitialSize, (int)(_peakUsage * 1.5f));
        // Remove excess available objects
        while (GetTotalCount() > target && GetAvailableCount() > 0)
            RemoveOneAvailable();
        _peakUsage = GetInUseCount();
    }
}
```

## Best Practices

1. **Warm pools at load time** — Pre-instantiate during loading screens
2. **Use signals for auto-release** — Objects signal when they're done
3. **Reset completely** — Clear all state in `Reset()` to avoid bugs
4. **Size appropriately** — Profile to find right initial/max sizes
5. **Handle exhaustion gracefully** — Log warnings, don't crash
6. **Clear on scene change** — Release all objects when changing levels
7. **Disable processing** — Pooled objects shouldn't run `_Process` when inactive

## Common Gotchas

- **Transform not reset**: Always reset position, rotation, scale in `Reset()`
- **Signals still connected**: Disconnect one-shot signals in `Reset()`
- **Physics still active**: Disable collision shapes when pooled
- **Timers still running**: Stop or reset any `Timer` nodes
- **Animation state**: Reset `AnimationPlayer` to initial state
- **Struct copy trap**: Modifying `Velocity` or `Position` requires reassignment
