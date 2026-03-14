# Async Patterns with ToSignal in Godot 4.x C#

Deep dive into asynchronous patterns in Godot C# using `async/await` and `ToSignal`.

## Core Concept: ToSignal

`ToSignal(object, signalName)` returns an awaitable that completes when the signal fires.
Use it inside `async void` or `async Task` methods.

```csharp
// Wait for an animation to finish
public async void PlayDeathSequence()
{
    _animationPlayer.Play("death");
    await ToSignal(_animationPlayer, AnimationPlayer.SignalName.AnimationFinished);
    QueueFree();
}

// Wait for a timer
public async void SpawnEnemyAfterDelay(float seconds)
{
    await ToSignal(GetTree().CreateTimer(seconds), SceneTreeTimer.SignalName.Timeout);
    SpawnEnemy();
}

// Wait for a custom signal
public async void OpenDoorSequence()
{
    _lever.Pulled += OnLeverPulled;        // connect
    await ToSignal(_lever, Lever.SignalName.Pulled);
    _door.Open();
}
```

## async void vs async Task

Use `async void` for fire-and-forget Godot lifecycle methods. Use `async Task` for composable coroutines:

```csharp
// async void — for event handlers and one-shot sequences
// Exceptions will crash — use try/catch
public async void OnButtonPressed()
{
    try
    {
        await PlayTransitionOut();
        GetTree().ChangeSceneToFile("res://scenes/game.tscn");
    }
    catch (Exception e)
    {
        GD.PushError($"Scene transition failed: {e.Message}");
    }
}

// async Task — composable, awaitable by caller
private async System.Threading.Tasks.Task PlayTransitionOut()
{
    _transitionAnim.Play("fade_out");
    await ToSignal(_transitionAnim, AnimationPlayer.SignalName.AnimationFinished);
}

// Await a Task
public async void StartGame()
{
    await PlayTransitionOut();
    // Now safe to change scene
}
```

## Common Patterns

### Tween Sequences

```csharp
// Wait for tween to complete
public async void FlashSprite(Color flashColor, float duration)
{
    var tween = CreateTween();
    tween.TweenProperty(this, "modulate", flashColor, duration * 0.5f);
    tween.TweenProperty(this, "modulate", Colors.White, duration * 0.5f);
    await ToSignal(tween, Tween.SignalName.Finished);
    // Tween is done
}

// Chained tweens
public async void BounceAnimation()
{
    for (int i = 0; i < 3; i++)
    {
        var tween = CreateTween();
        tween.TweenProperty(this, "scale", Vector2.One * 1.2f, 0.1f);
        tween.TweenProperty(this, "scale", Vector2.One, 0.1f);
        await ToSignal(tween, Tween.SignalName.Finished);
    }
}
```

### Timer Utilities

```csharp
// Extension method for cleaner timer syntax
public static class NodeExtensions
{
    public static SignalAwaiter WaitSeconds(this Node node, float seconds)
        => node.ToSignal(node.GetTree().CreateTimer(seconds), SceneTreeTimer.SignalName.Timeout);
}

// Usage
await this.WaitSeconds(2.0f);
GD.Print("2 seconds have passed");
```

### Scene Loading

```csharp
// Async scene loading with progress
public async void LoadLevelAsync(string path)
{
    ResourceLoader.LoadThreadedRequest(path);

    // Poll until loaded
    while (true)
    {
        var status = ResourceLoader.LoadThreadedGetStatus(path);
        if (status == ResourceLoader.ThreadLoadStatus.Loaded)
            break;
        if (status == ResourceLoader.ThreadLoadStatus.Failed)
        {
            GD.PushError($"Failed to load: {path}");
            return;
        }
        await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
    }

    var scene = ResourceLoader.LoadThreadedGet(path) as PackedScene;
    GetTree().ChangeSceneToPacked(scene);
}
```

### Cutscene / Dialogue Sequencing

```csharp
public async void PlayCutscene()
{
    // Step 1: fade in
    _overlay.Visible = true;
    var tween = CreateTween();
    tween.TweenProperty(_overlay, "modulate:a", 0.0f, 1.0f);
    await ToSignal(tween, Tween.SignalName.Finished);

    // Step 2: play dialogue
    _dialogueBox.Show("Welcome to the dungeon...");
    await ToSignal(_dialogueBox, DialogueBox.SignalName.Dismissed);

    // Step 3: animate character walking in
    _playerAnim.Play("walk_in");
    await ToSignal(_playerAnim, AnimationPlayer.SignalName.AnimationFinished);

    // Step 4: give control back
    EmitSignal(SignalName.CutsceneFinished);
}
```

### Input Confirmation

```csharp
// Wait for player to press a key
public async System.Threading.Tasks.Task<bool> WaitForConfirm(float timeout)
{
    float elapsed = 0f;

    while (elapsed < timeout)
    {
        if (Input.IsActionJustPressed("ui_accept"))
            return true;
        if (Input.IsActionJustPressed("ui_cancel"))
            return false;

        await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
        elapsed += (float)GetProcessDeltaTime();
    }

    return false; // Timed out
}
```

## Cancellation

Godot doesn't have built-in `CancellationToken` support for `ToSignal`, but you can use flags:

```csharp
private bool _cancelled = false;

public async void LongSequence()
{
    _cancelled = false;

    for (int i = 0; i < 10; i++)
    {
        if (_cancelled) return;

        await this.WaitSeconds(1.0f);
        SpawnWave(i);
    }
}

public void CancelSequence() => _cancelled = true;
```

## Running Multiple Awaits in Parallel

Use `Task.WhenAll` to await multiple signals simultaneously:

```csharp
public async void WaitForBothDoors()
{
    var doorA = ToSignal(_doorA, Door.SignalName.Opened);
    var doorB = ToSignal(_doorB, Door.SignalName.Opened);

    // Wait for both — ToSignal returns SignalAwaiter which is not directly
    // compatible with Task.WhenAll, so bridge to Task:
    await System.Threading.Tasks.Task.WhenAll(
        WaitForSignalAsTask(_doorA, Door.SignalName.Opened),
        WaitForSignalAsTask(_doorB, Door.SignalName.Opened)
    );

    UnlockNextArea();
}

private async System.Threading.Tasks.Task WaitForSignalAsTask(
    GodotObject obj, StringName signalName)
{
    await ToSignal(obj, signalName);
}
```

## Best Practices

1. **Use `async void` for fire-and-forget** — event handlers, `_Ready`, button callbacks
2. **Use `async Task` for composable sequences** — methods called by other async methods
3. **Always check `IsInstanceValid`** — the node may be freed while awaiting
4. **Guard with `_cancelled` flag** — for interruptible sequences
5. **Avoid `Task.Delay`** — use `ToSignal(GetTree().CreateTimer(...))` instead
6. **Handle exceptions in `async void`** — they won't propagate automatically

```csharp
// Safe pattern: check validity after await
public async void DelayedAction()
{
    await this.WaitSeconds(2.0f);

    // Node may have been freed during the wait
    if (!IsInstanceValid(this)) return;

    DoSomething();
}
```

## Common Gotchas

- **`async void` exceptions crash**: Wrap in try/catch for robustness
- **Awaiting freed objects**: `ToSignal` on a freed object throws — guard with `IsInstanceValid`
- **`Task.Delay` uses system clock**: Use Godot timer signals to respect pause/timescale
- **Multiple awaits on same signal**: Each `ToSignal` is a one-shot — reconnect for repeated use
- **GDScript interop**: GDScript can `await` C# signals declared with `[Signal]`
