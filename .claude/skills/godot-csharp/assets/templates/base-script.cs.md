# Base Script Template

Standard template for new C# scripts in Godot 4.x.

## Usage

Copy and customize for new scripts. Replace all `${placeholders}` with actual values. Remove unused sections.

## Template

```csharp
using Godot;

/// <summary>
/// ${Brief one-line description of this class.}
/// ${Optional longer description explaining purpose, usage, and any
/// important notes about how this class should be used.}
/// </summary>
public partial class ${ClassName} : ${ParentClass}
{
    // === Signals ===

    /// <summary>Emitted when ${describe when signal fires}.</summary>
    [Signal] public delegate void ${SignalName}EventHandler(${Type} ${param});


    // === Enums ===

    public enum ${EnumName}
    {
        ${ValueOne},
        ${ValueTwo},
        ${ValueThree},
    }


    // === Exports ===

    // [ExportGroup] is an Inspector section header — place it before the group's first property.
    // Put XML doc comments directly above [Export] so they clearly document the property, not the group.
    [ExportGroup("${Group Name}")]
    [Export] public ${Type} ${PropertyName} { get; set; } = ${defaultValue};

    [ExportGroup("${Another Group}")]
    /// <summary>${Description of this property.}</summary>
    [Export] public ${Type} ${AnotherProperty} { get; set; }


    // === Constants ===

    private const ${Type} ${ConstantName} = ${value};


    // === Public Properties ===

    /// <summary>${Description of this public property.}</summary>
    public ${Type} ${PublicProp} { get; private set; } = ${default};


    // === Private Fields ===

    private ${Type} _${privateField};
    private ${Type} _${anotherField} = ${default};

    // Node references — fetched in _Ready
    private ${NodeType} _${nodeRef};
    private ${NodeType} _${uniqueRef};


    // === Lifecycle Methods ===

    public override void _Ready()
    {
        _${nodeRef} = GetNode<${NodeType}>("${NodePath}");
        _${uniqueRef} = GetNode<${NodeType}>("%${UniqueName}");
        ${// Connect signals, initialize state}
    }

    public override void _Process(double delta)
    {
        ${// Called every frame}
    }

    public override void _PhysicsProcess(double delta)
    {
        ${// Called every physics frame (fixed timestep)}
    }

    public override void _Input(InputEvent @event)
    {
        ${// Handle input events}
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        ${// Handle input not consumed by UI}
    }


    // === Public Methods ===

    /// <summary>${Description of what this method does.}</summary>
    /// <param name="${paramName}">${Description of parameter.}</param>
    /// <returns>${Description of return value.}</returns>
    public ${ReturnType} ${PublicMethod}(${Type} ${paramName})
    {
        ${// Implementation}
        return ${value};
    }


    // === Private Methods ===

    private void ${PrivateMethod}()
    {
        ${// Internal implementation}
    }


    // === Signal Handlers ===

    private void On${SignalSource}${SignalName}(${params})
    {
        ${// Handle signal}
    }
}
```

## Section Order

Keep sections in this order for consistency:

1. `using` directives
2. XML `<summary>` doc comment
3. Class declaration (`public partial class`)
4. Signals (`[Signal]` delegates)
5. Enums
6. Exports (`[Export]`, `[ExportGroup]`)
7. Constants
8. Public properties
9. Private fields (prefixed with `_`)
10. Lifecycle methods (`_Ready`, `_Process`, etc.)
11. Public methods
12. Private methods
13. Signal handlers (prefixed with `On`)

## Minimal Template

For simple scripts:

```csharp
using Godot;

public partial class ${ClassName} : ${ParentClass}
{
    public override void _Ready()
    {
    }
}
```

## Component Template

For reusable components:

```csharp
using Godot;

/// <summary>${Description of component purpose.}</summary>
public partial class ${ComponentName}Component : Node
{
    // === Signals ===

    [Signal] public delegate void ${StateChanged}EventHandler(${Type} ${newValue});


    // === Exports ===

    [Export] public ${Type} ${ConfigurableValue} { get; set; } = ${default};


    // === Public Methods ===

    public void ${MainAction}(${Type} ${param})
    {
        ${// Component logic}
        EmitSignal(SignalName.${StateChanged}, ${newValue});
    }
}
```

## Notes

- Always use `partial class` — required for Godot's source generator
- Use XML `<summary>` for public API documentation
- Use `//` for implementation comments
- Prefix private fields with `_`
- Cache node references in `_Ready()`, never in `_Process()`
- Use `GetNode<T>("%UniqueName")` for stable unique-name references
- Use `IsInstanceValid(node)` instead of `node != null` for freed node checks
