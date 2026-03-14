# State Machine Template

Enum-based state machine pattern for Godot 4.x C#.

## Usage

Use for entities with distinct behavioral modes (idle, walking, attacking, etc.).

## Template

```csharp
using Godot;

/// <summary>${Description} with state machine behavior.</summary>
public partial class ${ClassName} : ${ParentClass}
{
    // === Signals ===

    [Signal] public delegate void StateChangedEventHandler(int oldState, int newState);


    // === Enums ===

    public enum State
    {
        ${Idle},
        ${Moving},
        ${Attacking},
        ${Hurt},
    }


    // === Exports ===

    [Export] public State InitialState { get; set; } = State.${Idle};


    // === Public Properties ===

    private State _currentState = State.${Idle};
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


    // === Private Fields ===

    private double _stateTime;
    private AnimationPlayer _animationPlayer;
    private Sprite2D _sprite;


    // === Lifecycle Methods ===

    public override void _Ready()
    {
        _animationPlayer = GetNode<AnimationPlayer>("AnimationPlayer");
        _sprite = GetNode<Sprite2D>("Sprite2D");
        CurrentState = InitialState;
    }

    public override void _PhysicsProcess(double delta)
    {
        _stateTime += delta;
        ProcessState(delta);
    }


    // === State Machine Core ===

    private void EnterState(State state)
    {
        _stateTime = 0.0;
        switch (state)
        {
            case State.${Idle}:     _animationPlayer.Play("idle"); break;
            case State.${Moving}:   _animationPlayer.Play("move"); break;
            case State.${Attacking}: _animationPlayer.Play("attack"); break;
            case State.${Hurt}:     _animationPlayer.Play("hurt"); break;
        }
    }

    private void ExitState(State state)
    {
        switch (state)
        {
            case State.${Idle}:     break;
            case State.${Moving}:   break;
            case State.${Attacking}: break;
            case State.${Hurt}:     break;
        }
    }

    private void ProcessState(double delta)
    {
        switch (_currentState)
        {
            case State.${Idle}:     Process${Idle}(delta); break;
            case State.${Moving}:   Process${Moving}(delta); break;
            case State.${Attacking}: Process${Attacking}(delta); break;
            case State.${Hurt}:     Process${Hurt}(delta); break;
        }
    }


    // === State Processors ===

    private void Process${Idle}(double delta)
    {
        // Check for transitions
        if (${shouldMove})
            CurrentState = State.${Moving};
        else if (${shouldAttack})
            CurrentState = State.${Attacking};
    }

    private void Process${Moving}(double delta)
    {
        // Movement logic

        // Check for transitions
        if (${shouldStop})
            CurrentState = State.${Idle};
        else if (${shouldAttack})
            CurrentState = State.${Attacking};
    }

    private void Process${Attacking}(double delta)
    {
        // Attack logic (usually wait for animation)
    }

    private void Process${Hurt}(double delta)
    {
        // Hurt logic (usually wait for animation)
    }


    // === Signal Handlers ===

    private void OnAnimationPlayerAnimationFinished(StringName animName)
    {
        if (animName == "attack" || animName == "hurt")
            CurrentState = State.${Idle};
    }


    // === Public Methods ===

    /// <summary>Force a state change — useful for external events like taking damage.</summary>
    public void ForceState(State newState) => CurrentState = newState;

    /// <summary>Returns true if the entity is in the given state.</summary>
    public bool IsInState(State state) => _currentState == state;
}
```

## Player Example

Complete player controller with state machine:

```csharp
using Godot;

public partial class Player : CharacterBody2D
{
    [Signal] public delegate void DiedEventHandler();

    public enum State { Idle, Walk, Jump, Attack, Hurt, Dead }

    [Export] public float MoveSpeed { get; set; } = 200.0f;
    [Export] public float JumpForce { get; set; } = -400.0f;
    [Export] public float Gravity { get; set; } = 980.0f;

    private State _currentState = State.Idle;
    public State CurrentState
    {
        get => _currentState;
        set
        {
            if (_currentState == value) return;
            ExitState(_currentState);
            _currentState = value;
            EnterState(_currentState);
        }
    }

    private float _inputDirection;
    private AnimationPlayer _anim;
    private Sprite2D _sprite;

    public override void _Ready()
    {
        _anim = GetNode<AnimationPlayer>("AnimationPlayer");
        _sprite = GetNode<Sprite2D>("Sprite2D");
        _anim.AnimationFinished += OnAnimationFinished;
    }

    public override void _PhysicsProcess(double delta)
    {
        _inputDirection = Input.GetAxis("move_left", "move_right");
        ApplyGravity(delta);
        ProcessState(delta);
        MoveAndSlide();
    }

    private void ApplyGravity(double delta)
    {
        if (!IsOnFloor())
        {
            var vel = Velocity;
            vel.Y += Gravity * (float)delta;
            Velocity = vel;
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
                var v = Velocity;
                v.X = 0;
                Velocity = v;
                _anim.Play("attack");
                break;
            case State.Hurt:
                Velocity = new Vector2(-_sprite.Scale.X * 100, -200);
                _anim.Play("hurt");
                break;
            case State.Dead:
                Velocity = Vector2.Zero;
                _anim.Play("death");
                EmitSignal(SignalName.Died);
                break;
        }
    }

    private void ExitState(State state) { }

    private void ProcessState(double delta)
    {
        switch (_currentState)
        {
            case State.Idle:
                var vel = Velocity;
                vel.X = 0;
                Velocity = vel;
                if (_inputDirection != 0)
                    CurrentState = State.Walk;
                else if (Input.IsActionJustPressed("jump") && IsOnFloor())
                    CurrentState = State.Jump;
                else if (Input.IsActionJustPressed("attack"))
                    CurrentState = State.Attack;
                break;

            case State.Walk:
                var walkVel = Velocity;
                walkVel.X = _inputDirection * MoveSpeed;
                Velocity = walkVel;
                if (_inputDirection != 0)
                    _sprite.Scale = _sprite.Scale with { X = Mathf.Sign(_inputDirection) };
                if (_inputDirection == 0)
                    CurrentState = State.Idle;
                else if (Input.IsActionJustPressed("jump") && IsOnFloor())
                    CurrentState = State.Jump;
                else if (Input.IsActionJustPressed("attack"))
                    CurrentState = State.Attack;
                break;

            case State.Jump:
                var jumpVel = Velocity;
                jumpVel.X = _inputDirection * MoveSpeed;
                Velocity = jumpVel;
                if (IsOnFloor())
                    CurrentState = State.Idle;
                break;

            case State.Attack:
            case State.Hurt:
                break; // Wait for animation

            case State.Dead:
                break; // No processing
        }
    }

    public void TakeDamage(int amount)
    {
        if (_currentState == State.Dead) return;
        // Apply damage, check death…
        CurrentState = State.Hurt;
    }

    private void OnAnimationFinished(StringName animName)
    {
        if (animName == "attack" || animName == "hurt")
            CurrentState = State.Idle;
    }
}
```

## Notes

- State changes through property setter for consistency
- `EnterState` handles setup (animations, velocity changes)
- `ExitState` handles cleanup
- `ProcessState` handles per-frame logic and transitions
- Signal handlers can trigger state changes (animation finished)
- Consider extracting to separate State node classes for complex behavior
