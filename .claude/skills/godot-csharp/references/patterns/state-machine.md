# State Machine Patterns

Complete guide to implementing state machines in Godot 4.x C#.

## When to Use State Machines

Use state machines when:
- Entity has distinct behavioral modes (idle, walking, attacking)
- Transitions between modes have specific rules
- State-specific logic would clutter a single script
- You need clear visual representation of behavior flow

## Pattern 1: Enum-Based State Machine

Simplest approach for entities with few states:

```csharp
public partial class Player : CharacterBody2D
{
    public enum State { Idle, Walk, Jump, Attack, Hurt }

    [Signal] public delegate void StateChangedEventHandler(int oldState, int newState);

    [Export] public float MoveSpeed { get; set; } = 200.0f;
    [Export] public float JumpForce { get; set; } = -400.0f;

    private State _currentState = State.Idle;
    public State CurrentState
    {
        get => _currentState;
        set
        {
            if (_currentState == value) return;
            var old = _currentState;
            ExitState(_currentState);
            _currentState = value;
            EnterState(_currentState);
            EmitSignal(SignalName.StateChanged, (int)old, (int)_currentState);
        }
    }

    private float _inputDirection;
    private AnimationPlayer _anim;

    public override void _Ready()
    {
        _anim = GetNode<AnimationPlayer>("AnimationPlayer");
        _anim.AnimationFinished += OnAnimationFinished;
    }

    public override void _PhysicsProcess(double delta)
    {
        _inputDirection = Input.GetAxis("move_left", "move_right");
        ProcessState(delta);
        MoveAndSlide();
    }

    private void ProcessState(double delta)
    {
        switch (_currentState)
        {
            case State.Idle:   ProcessIdle(delta); break;
            case State.Walk:   ProcessWalk(delta); break;
            case State.Jump:   ProcessJump(delta); break;
            case State.Attack: ProcessAttack(delta); break;
            case State.Hurt:   ProcessHurt(delta); break;
        }
    }

    private void EnterState(State state)
    {
        switch (state)
        {
            case State.Idle:
                _anim.Play("idle");
                break;
            case State.Walk:
                _anim.Play("walk");
                break;
            case State.Jump:
                var vel = Velocity;
                vel.Y = JumpForce;
                Velocity = vel;
                _anim.Play("jump");
                break;
            case State.Attack:
                _anim.Play("attack");
                break;
            case State.Hurt:
                _anim.Play("hurt");
                Velocity = Vector2.Zero;
                break;
        }
    }

    private void ExitState(State state)
    {
        if (state == State.Attack)
            GetNode<Area2D>("Hitbox").Monitoring = false;
    }

    private void ProcessIdle(double delta)
    {
        if (_inputDirection != 0)
            CurrentState = State.Walk;
        else if (Input.IsActionJustPressed("jump") && IsOnFloor())
            CurrentState = State.Jump;
        else if (Input.IsActionJustPressed("attack"))
            CurrentState = State.Attack;
    }

    private void ProcessWalk(double delta)
    {
        var vel = Velocity;
        vel.X = _inputDirection * MoveSpeed;
        Velocity = vel;

        if (_inputDirection == 0)
            CurrentState = State.Idle;
        else if (Input.IsActionJustPressed("jump") && IsOnFloor())
            CurrentState = State.Jump;
        else if (Input.IsActionJustPressed("attack"))
            CurrentState = State.Attack;
    }

    private void ProcessJump(double delta)
    {
        var vel = Velocity;
        vel.Y += GetGravity().Y * (float)delta;
        Velocity = vel;

        if (IsOnFloor())
            CurrentState = State.Idle;
    }

    private void ProcessAttack(double delta) { } // Wait for animation
    private void ProcessHurt(double delta) { }   // Wait for hurt animation

    private void OnAnimationFinished(StringName animName)
    {
        if (animName == "attack" || animName == "hurt")
            CurrentState = State.Idle;
    }
}
```

## Pattern 2: State Node Pattern

Each state is a child node. Better for complex states with their own resources:

```csharp
// StateMachine.cs — parent node managing state transitions
public partial class StateMachine : Node
{
    [Signal] public delegate void StateChangedEventHandler(
        GodotObject oldState, GodotObject newState);

    [Export] public NodePath InitialStatePath { get; set; }

    public StateBase CurrentState { get; private set; }
    private readonly Dictionary<string, StateBase> _states = new();

    public override void _Ready()
    {
        foreach (var child in GetChildren())
        {
            if (child is StateBase state)
            {
                _states[state.Name] = state;
                state.StateMachine = this;
                state.ProcessMode = ProcessModeEnum.Disabled;
            }
        }

        if (InitialStatePath != null)
        {
            CurrentState = GetNode<StateBase>(InitialStatePath);
            CurrentState.ProcessMode = ProcessModeEnum.Inherit;
            CurrentState.Enter();
        }
    }

    public override void _Process(double delta) => CurrentState?.Update(delta);

    public override void _PhysicsProcess(double delta) => CurrentState?.PhysicsUpdate(delta);

    public void TransitionTo(string stateName)
    {
        if (!_states.TryGetValue(stateName, out var newState)) return;
        if (CurrentState == newState) return;

        var old = CurrentState;
        CurrentState?.Exit();
        CurrentState?.ProcessMode = ProcessModeEnum.Disabled;

        CurrentState = newState;
        CurrentState.ProcessMode = ProcessModeEnum.Inherit;
        CurrentState.Enter();

        EmitSignal(SignalName.StateChanged, old, CurrentState);
    }
}
```

```csharp
// StateBase.cs — base class for all states
public partial class StateBase : Node
{
    public StateMachine StateMachine { get; set; }

    public virtual void Enter() { }
    public virtual void Exit() { }
    public virtual void Update(double delta) { }
    public virtual void PhysicsUpdate(double delta) { }
}
```

```csharp
// IdleState.cs — concrete state implementation
public partial class IdleState : StateBase
{
    private Player _player;

    public override void _Ready()
    {
        _player = GetParent<StateMachine>().GetParent<Player>();
    }

    public override void Enter()
    {
        _player.AnimationPlayer.Play("idle");
    }

    public override void PhysicsUpdate(double delta)
    {
        float inputDir = Input.GetAxis("move_left", "move_right");

        if (inputDir != 0)
            StateMachine.TransitionTo("Walk");
        else if (Input.IsActionJustPressed("jump") && _player.IsOnFloor())
            StateMachine.TransitionTo("Jump");
    }
}
```

**Scene Tree Structure:**
```
Player (CharacterBody2D)
├── Sprite2D
├── CollisionShape2D
├── AnimationPlayer
└── StateMachine (Node)
    ├── Idle (StateBase)
    ├── Walk (StateBase)
    ├── Jump (StateBase)
    └── Attack (StateBase)
```

## Pattern 3: Pushdown Automaton

Stack-based state machine for states that need to "return" (menus, pause):

```csharp
public partial class PushdownStateMachine : Node
{
    [Signal] public delegate void StatePushedEventHandler(GodotObject state);
    [Signal] public delegate void StatePoppedEventHandler(GodotObject state);

    private readonly Stack<StateBase> _stack = new();

    public StateBase CurrentState => _stack.Count > 0 ? _stack.Peek() : null;

    public override void _Process(double delta) => CurrentState?.Update(delta);

    public void PushState(StateBase state)
    {
        CurrentState?.Pause();
        _stack.Push(state);
        state.Enter();
        EmitSignal(SignalName.StatePushed, state);
    }

    public StateBase PopState()
    {
        if (_stack.Count == 0) return null;

        var popped = _stack.Pop();
        popped.Exit();
        EmitSignal(SignalName.StatePopped, popped);
        CurrentState?.Resume();
        return popped;
    }

    public void ReplaceState(StateBase state)
    {
        PopState();
        PushState(state);
    }
}

// Extended base class with pause/resume
public partial class PushdownState : StateBase
{
    public virtual void Pause() { }
    public virtual void Resume() { }
}
```

## Pattern 4: Hierarchical State Machine

States can have substates (e.g., Grounded contains Idle and Walk):

```csharp
public partial class HierarchicalState : StateBase
{
    [Export] public NodePath InitialSubstatePath { get; set; }

    protected HierarchicalState ActiveSubstate { get; private set; }
    private readonly Dictionary<string, HierarchicalState> _substates = new();

    public override void _Ready()
    {
        foreach (var child in GetChildren())
        {
            if (child is HierarchicalState sub)
                _substates[sub.Name] = sub;
        }
    }

    public override void Enter()
    {
        if (InitialSubstatePath != null)
        {
            var initial = GetNode<HierarchicalState>(InitialSubstatePath);
            TransitionToSubstate(initial.Name);
        }
    }

    public override void Exit()
    {
        ActiveSubstate?.Exit();
        ActiveSubstate = null;
    }

    public override void Update(double delta) => ActiveSubstate?.Update(delta);

    public void TransitionToSubstate(string name)
    {
        if (!_substates.TryGetValue(name, out var next)) return;
        ActiveSubstate?.Exit();
        ActiveSubstate = next;
        ActiveSubstate.Enter();
    }
}
```

**Example hierarchy:**
```
StateMachine
├── Grounded (HierarchicalState)
│   ├── Idle (StateBase)
│   └── Walk (StateBase)
├── Airborne (HierarchicalState)
│   ├── Jump (StateBase)
│   └── Fall (StateBase)
└── Combat (HierarchicalState)
    ├── Attack (StateBase)
    └── Block (StateBase)
```

## Transition Guards

Validate transitions before allowing them:

```csharp
public class StateTransitions
{
    private readonly Dictionary<int, List<int>> _allowed = new();

    public StateTransitions Allow(int from, int to)
    {
        if (!_allowed.ContainsKey(from))
            _allowed[from] = new List<int>();
        _allowed[from].Add(to);
        return this;
    }

    public StateTransitions AllowFromAny(int to)
    {
        const int anyKey = -1;
        if (!_allowed.ContainsKey(anyKey))
            _allowed[anyKey] = new List<int>();
        _allowed[anyKey].Add(to);
        return this;
    }

    public bool CanTransition(int from, int to)
    {
        if (_allowed.TryGetValue(-1, out var anyTargets) && anyTargets.Contains(to))
            return true;
        return _allowed.TryGetValue(from, out var targets) && targets.Contains(to);
    }
}

// Usage
private readonly StateTransitions _transitions = new StateTransitions()
    .Allow((int)State.Idle, (int)State.Walk)
    .Allow((int)State.Idle, (int)State.Jump)
    .Allow((int)State.Walk, (int)State.Idle)
    .Allow((int)State.Walk, (int)State.Jump)
    .Allow((int)State.Jump, (int)State.Idle)
    .AllowFromAny((int)State.Hurt);

private bool TryChangeState(State newState)
{
    if (!_transitions.CanTransition((int)_currentState, (int)newState))
        return false;
    CurrentState = newState;
    return true;
}
```

## Best Practices

1. **Keep states focused** — One state, one responsibility
2. **Use signals for external communication** — States shouldn't directly modify other systems
3. **Validate transitions** — Not all state changes should be allowed
4. **Handle animation in Enter/Exit** — Keeps animation logic centralized
5. **Consider state history** — Sometimes you need to return to previous state
6. **Use enums for simple cases** — Node-based for complex per-state logic
