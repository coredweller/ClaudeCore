# Input Handling Patterns

Complete guide to implementing robust input systems in Godot 4.x C#.

> **Note:** All examples assume `<ImplicitUsings>enable</ImplicitUsings>` in the `.csproj`. BCL namespaces (`System`, `System.Collections.Generic`, `System.Linq`, etc.) are available without explicit `using` directives.

## Input System Basics

Godot's input system provides:
- **Input Map**: Named actions mapped to keys/buttons
- **Input singleton**: Query current input state
- **`_Input()` / `_UnhandledInput()`**: Event-based handling

## Pattern 1: Action-Based Input

Always use Input Map actions instead of raw key codes:

```csharp
// Project Settings > Input Map defines:
// - move_left: A, Left Arrow, Gamepad Left
// - move_right: D, Right Arrow, Gamepad Right
// - jump: Space, Gamepad A
// - attack: Mouse Left, Gamepad X

public override void _PhysicsProcess(double delta)
{
    // Axis input (returns -1 to 1)
    float inputDir = Input.GetAxis("move_left", "move_right");
    var vel = Velocity;
    vel.X = inputDir * MoveSpeed;
    Velocity = vel;

    // 2D vector input
    Vector2 moveVector = Input.GetVector("move_left", "move_right", "move_up", "move_down");

    // Button states
    if (Input.IsActionJustPressed("jump"))
        Jump();

    if (Input.IsActionPressed("attack"))
        ChargeAttack();

    if (Input.IsActionJustReleased("attack"))
        ReleaseAttack();
}

public override void _UnhandledInput(InputEvent @event)
{
    if (@event.IsActionPressed("pause"))
    {
        TogglePause();
        GetViewport().SetInputAsHandled();
    }
}
```

## Pattern 2: Input Buffer

Buffer inputs for responsive controls (fighting games, platformers):

```csharp
public partial class InputBuffer : Node
{
    /// <summary>How long inputs stay in buffer (seconds).</summary>
    [Export] public float BufferDuration { get; set; } = 0.15f;

    private readonly Dictionary<string, double> _buffer = new();
    private static readonly string[] TrackedActions = { "jump", "attack", "dash" };

    public override void _Process(double delta) => UpdateBuffer();

    private void UpdateBuffer()
    {
        double now = Time.GetTicksMsec() / 1000.0;

        // Add new inputs
        foreach (var action in TrackedActions)
        {
            if (Input.IsActionJustPressed(action))
                _buffer[action] = now;
        }

        // Remove expired inputs
        var expired = new List<string>();
        foreach (var (action, time) in _buffer)
        {
            if (now - time > BufferDuration)
                expired.Add(action);
        }
        foreach (var action in expired)
            _buffer.Remove(action);
    }

    /// <summary>Check if action is buffered and consume it.</summary>
    public bool Consume(string action)
    {
        if (!_buffer.ContainsKey(action)) return false;
        _buffer.Remove(action);
        return true;
    }

    /// <summary>Check if action is buffered without consuming.</summary>
    public bool IsBuffered(string action) => _buffer.ContainsKey(action);

    public void Clear(string action) => _buffer.Remove(action);
    public void ClearAll() => _buffer.Clear();
}
```

**Usage:**

```csharp
private InputBuffer _inputBuffer;

public override void _Ready()
{
    _inputBuffer = GetNode<InputBuffer>("InputBuffer");
}

public override void _PhysicsProcess(double delta)
{
    // Player can press jump slightly before landing
    if (IsOnFloor() && _inputBuffer.Consume("jump"))
        Jump();

    // Coyote time: can jump briefly after leaving platform
    if (_wasOnFloor && !IsOnFloor())
        _coyoteTimer = CoyoteTime;

    if (_coyoteTimer > 0 && _inputBuffer.Consume("jump"))
        Jump();
}
```

## Pattern 3: Input Context Stack

Different input contexts for different game states:

```csharp
public class InputContext
{
    private readonly Dictionary<string, Action> _actions = new();

    public InputContext Bind(string action, Action callback)
    {
        _actions[action] = callback;
        return this;
    }

    public bool HandleInput(InputEvent @event)
    {
        foreach (var (action, callback) in _actions)
        {
            if (@event.IsActionPressed(action))
            {
                callback();
                return true;
            }
        }
        return false;
    }
}

public partial class InputManager : Node
{
    private readonly Stack<InputContext> _contexts = new();

    public InputContext CurrentContext
        => _contexts.Count > 0 ? _contexts.Peek() : null;

    public void PushContext(InputContext context) => _contexts.Push(context);

    public InputContext PopContext()
        => _contexts.Count > 0 ? _contexts.Pop() : null;

    public override void _UnhandledInput(InputEvent @event)
    {
        if (CurrentContext?.HandleInput(@event) == true)
            GetViewport().SetInputAsHandled();
    }
}
```

**Usage:**

```csharp
private InputContext _gameplayContext;
private InputContext _menuContext;
private InputManager _inputManager;

public override void _Ready()
{
    _inputManager = GetNode<InputManager>("/root/InputManager");

    _gameplayContext = new InputContext()
        .Bind("jump", OnJump)
        .Bind("attack", OnAttack)
        .Bind("pause", OnPause);

    _menuContext = new InputContext()
        .Bind("ui_accept", OnMenuSelect)
        .Bind("ui_cancel", OnMenuBack)
        .Bind("pause", OnUnpause);

    _inputManager.PushContext(_gameplayContext);
}

private void OnPause()
{
    _inputManager.PushContext(_menuContext);
    GetTree().Paused = true;
}

private void OnUnpause()
{
    _inputManager.PopContext();
    GetTree().Paused = false;
}
```

## Pattern 4: Rebindable Controls

Allow players to customize controls:

```csharp
public partial class InputRemapper : Node
{
    private const string SavePath = "user://input_config.cfg";
    private readonly Dictionary<string, Godot.Collections.Array<InputEvent>> _defaults = new();

    public override void _Ready()
    {
        SaveDefaults();
        LoadCustomMappings();
    }

    private void SaveDefaults()
    {
        foreach (StringName action in InputMap.GetActions())
        {
            if (action.ToString().StartsWith("ui_")) continue;
            _defaults[action] = new Godot.Collections.Array<InputEvent>(
                InputMap.ActionGetEvents(action));
        }
    }

    public void RemapAction(string action, InputEvent @event)
    {
        InputMap.ActionEraseEvents(action);
        InputMap.ActionAddEvent(action, @event);
        SaveCustomMappings();
    }

    public void ResetAction(string action)
    {
        if (!_defaults.TryGetValue(action, out var defaults)) return;
        InputMap.ActionEraseEvents(action);
        foreach (var e in defaults)
            InputMap.ActionAddEvent(action, e);
        SaveCustomMappings();
    }

    public void ResetAll()
    {
        foreach (var action in _defaults.Keys)
            ResetAction(action);
    }

    private void SaveCustomMappings()
    {
        var config = new ConfigFile();

        foreach (StringName action in InputMap.GetActions())
        {
            if (action.ToString().StartsWith("ui_")) continue;
            var events = InputMap.ActionGetEvents(action);
            for (int i = 0; i < events.Count; i++)
            {
                var key = $"{action}_{i}";
                switch (events[i])
                {
                    case InputEventKey keyEvent:
                        config.SetValue("keys", key, (int)keyEvent.Keycode);
                        break;
                    case InputEventMouseButton mouseEvent:
                        config.SetValue("mouse", key, (int)mouseEvent.ButtonIndex);
                        break;
                    case InputEventJoypadButton joyButton:
                        config.SetValue("joypad_button", key, (int)joyButton.ButtonIndex);
                        break;
                }
            }
        }

        config.Save(SavePath);
    }

    private void LoadCustomMappings()
    {
        var config = new ConfigFile();
        if (config.Load(SavePath) != Error.Ok) return;

        foreach (var action in _defaults.Keys)
            InputMap.ActionEraseEvents(action);

        if (config.HasSection("keys"))
        {
            foreach (var key in config.GetSectionKeys("keys"))
            {
                var action = key.Substring(0, key.LastIndexOf('_'));
                var keycode = (Key)(int)config.GetValue("keys", key);
                InputMap.ActionAddEvent(action, new InputEventKey { Keycode = keycode });
            }
        }
    }
}
```

## Pattern 5: Combo System

Detect input sequences (fighting game combos):

```csharp
public partial class ComboDetector : Node
{
    [Signal] public delegate void ComboDetectedEventHandler(string comboName);

    [Export] public float ComboWindow { get; set; } = 0.5f;

    private readonly List<(string Action, double Timestamp)> _history = new();
    private readonly Dictionary<string, string[]> _combos = new();

    private static readonly string[] WatchedActions =
        { "up", "down", "left", "right", "punch", "kick" };

    public void RegisterCombo(string name, params string[] sequence)
        => _combos[name] = sequence;

    public override void _UnhandledInput(InputEvent @event)
    {
        foreach (var action in WatchedActions)
        {
            if (@event.IsActionPressed(action))
            {
                RecordInput(action);
                CheckCombos();
            }
        }
    }

    private void RecordInput(string action)
    {
        double now = Time.GetTicksMsec() / 1000.0;
        _history.RemoveAll(e => now - e.Timestamp > ComboWindow);
        _history.Add((action, now));
    }

    private void CheckCombos()
    {
        var recent = _history.Select(e => e.Action).ToList();

        foreach (var (name, sequence) in _combos)
        {
            if (EndsWith(recent, sequence))
            {
                EmitSignal(SignalName.ComboDetected, name);
                _history.Clear();
                break;
            }
        }
    }

    private static bool EndsWith(List<string> history, string[] sequence)
    {
        if (history.Count < sequence.Length) return false;
        int start = history.Count - sequence.Length;
        for (int i = 0; i < sequence.Length; i++)
            if (history[start + i] != sequence[i]) return false;
        return true;
    }
}
```

**Usage:**

```csharp
private ComboDetector _comboDetector;

public override void _Ready()
{
    _comboDetector = GetNode<ComboDetector>("ComboDetector");
    _comboDetector.RegisterCombo("hadouken", "down", "right", "punch");
    _comboDetector.RegisterCombo("shoryuken", "right", "down", "right", "punch");
    _comboDetector.ComboDetected += OnComboDetected;
}

private void OnComboDetected(string comboName)
{
    switch (comboName)
    {
        case "hadouken":   SpawnFireball(); break;
        case "shoryuken":  PerformUppercut(); break;
    }
}
```

## Touch Input

Handle touch for mobile:

```csharp
public override void _Input(InputEvent @event)
{
    switch (@event)
    {
        case InputEventScreenTouch touch:
            if (touch.Pressed)
                OnTouchStart(touch.Position, touch.Index);
            else
                OnTouchEnd(touch.Position, touch.Index);
            break;

        case InputEventScreenDrag drag:
            OnTouchDrag(drag.Position, drag.Relative, drag.Index);
            break;
    }
}

private Vector2 _touchOrigin;
private Vector2 _touchCurrent;
private const float JoystickRadius = 100.0f;

private void OnTouchStart(Vector2 pos, int index)
{
    _touchOrigin = pos;
    _touchCurrent = pos;
}

private void OnTouchDrag(Vector2 pos, Vector2 relative, int index)
{
    _touchCurrent = pos;
}

public Vector2 GetVirtualJoystick()
{
    var diff = _touchCurrent - _touchOrigin;
    if (diff.Length() > JoystickRadius)
        diff = diff.Normalized() * JoystickRadius;
    return diff / JoystickRadius; // -1 to 1
}
```

## Best Practices

1. **Always use Input Map** — Never hardcode `Key.*` or `MouseButton.*` constants
2. **Use semantic action names** — `"jump"` not `"space_pressed"`
3. **Buffer important inputs** — Especially for action games
4. **Support multiple input methods** — Keyboard, gamepad, touch
5. **Allow rebinding** — Players expect customization
6. **Consider accessibility** — One-handed modes, toggle vs hold
7. **Handle focus** — Disable input when window loses focus

## Common Gotchas

- **Input not detected while paused**: Set `ProcessMode = ProcessModeEnum.Always`
- **Double input**: Check that both `_Input` and `_Process` aren't handling the same action
- **Gamepad not working**: Ensure device is connected before Input Map check
- **UI consuming input**: Use `_UnhandledInput` for gameplay
- **Mouse position wrong**: Use `GetGlobalMousePosition()` for world space
- **`@event` parameter**: Must use verbatim identifier `@event` in C# since `event` is a keyword
