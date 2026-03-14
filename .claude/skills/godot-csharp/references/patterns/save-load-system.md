# Save/Load System Patterns

Complete guide to implementing save systems in Godot 4.x C#.

## Save System Approaches

| Approach | Best For | Pros | Cons |
|----------|----------|------|------|
| Custom Resource | Structured game data | Type-safe, fast, editor preview | Binary format, version migration |
| JSON | Config, web games | Human-readable, portable | Manual serialization |
| ConfigFile | Settings, simple saves | Built-in, INI format | Limited structure |
| Binary | Large datasets | Compact, fast | Not human-readable |

## Pattern 1: Resource-Based Save System

Type-safe saves using custom Resources:

```csharp
// SaveData.cs — custom resource for save data
public partial class SaveData : Resource
{
    [Export] public int Version { get; set; } = 1;
    [Export] public long Timestamp { get; set; }

    // Player data
    [Export] public Vector2 PlayerPosition { get; set; }
    [Export] public int PlayerHealth { get; set; } = 100;
    [Export] public int PlayerMaxHealth { get; set; } = 100;

    // Inventory
    [Export] public Godot.Collections.Array<string> Inventory { get; set; } = new();
    [Export] public string EquippedWeapon { get; set; } = "";
    [Export] public int Gold { get; set; }

    // Progress
    [Export] public string CurrentLevel { get; set; } = "res://scenes/levels/Level01.tscn";
    [Export] public Godot.Collections.Array<string> UnlockedLevels { get; set; } = new();
    [Export] public Godot.Collections.Array<string> CompletedQuests { get; set; } = new();

    // Settings
    [Export] public float MusicVolume { get; set; } = 1.0f;
    [Export] public float SfxVolume { get; set; } = 1.0f;

    public static SaveData CreateNew()
    {
        return new SaveData
        {
            Timestamp = (long)Time.GetUnixTimeFromSystem()
        };
    }
}
```

```csharp
// SaveManager.cs — autoload for save/load operations
public partial class SaveManager : Node
{
    [Signal] public delegate void SaveCompletedEventHandler(int slot);
    [Signal] public delegate void LoadCompletedEventHandler(int slot, SaveData data);
    [Signal] public delegate void SaveFailedEventHandler(int slot, string error);

    private const string SaveDir = "user://saves/";
    private const string SaveExtension = ".tres"; // Or ".res" for binary

    public SaveData CurrentSave { get; private set; }

    public override void _Ready() => EnsureSaveDirectory();

    private void EnsureSaveDirectory()
        => DirAccess.MakeDirRecursiveAbsolute(SaveDir);

    public string GetSavePath(int slot)
        => $"{SaveDir}save_{slot:D2}{SaveExtension}";

    public bool SaveExists(int slot)
        => FileAccess.FileExists(GetSavePath(slot));

    public Error SaveGame(int slot)
    {
        CurrentSave ??= SaveData.CreateNew();
        CurrentSave.Timestamp = (long)Time.GetUnixTimeFromSystem();
        CollectSaveData();

        var path = GetSavePath(slot);
        var error = ResourceSaver.Save(CurrentSave, path);

        if (error == Error.Ok)
            EmitSignal(SignalName.SaveCompleted, slot);
        else
            EmitSignal(SignalName.SaveFailed, slot, error.ToString());

        return error;
    }

    public SaveData LoadGame(int slot)
    {
        var path = GetSavePath(slot);

        if (!FileAccess.FileExists(path))
        {
            GD.PushError($"Save file not found: {path}");
            return null;
        }

        var loaded = ResourceLoader.Load<SaveData>(path);
        if (loaded == null)
        {
            GD.PushError($"Failed to load save: {path}");
            return null;
        }

        CurrentSave = loaded;
        ApplySaveData();
        EmitSignal(SignalName.LoadCompleted, slot, CurrentSave);
        return CurrentSave;
    }

    public Error DeleteSave(int slot)
    {
        var path = GetSavePath(slot);
        return FileAccess.FileExists(path) ? DirAccess.RemoveAbsolute(path) : Error.Ok;
    }

    public Godot.Collections.Dictionary GetSaveInfo(int slot)
    {
        var path = GetSavePath(slot);
        if (!FileAccess.FileExists(path)) return new();

        var data = ResourceLoader.Load<SaveData>(path);
        if (data == null) return new();

        return new Godot.Collections.Dictionary
        {
            { "slot", slot },
            { "timestamp", data.Timestamp },
            { "level", data.CurrentLevel }
        };
    }

    // Override to customize what gets saved/loaded
    private void CollectSaveData()
    {
        var player = GetTree().GetFirstNodeInGroup("player") as Player;
        if (player != null)
        {
            CurrentSave.PlayerPosition = player.GlobalPosition;
            CurrentSave.PlayerHealth = player.Health;
        }
    }

    private void ApplySaveData()
    {
        // Apply saved data to game state after scene is loaded
    }
}
```

## Pattern 2: JSON Save System

Human-readable saves with JSON:

```csharp
public partial class JsonSaveManager : Node
{
    private const string SaveDir = "user://saves/";

    public Error SaveToJson(int slot, Godot.Collections.Dictionary data)
    {
        var path = $"{SaveDir}save_{slot:D2}.json";
        var json = Json.Stringify(data, "\t");

        using var file = FileAccess.Open(path, FileAccess.ModeFlags.Write);
        if (file == null)
            return FileAccess.GetOpenError();

        file.StoreString(json);
        return Error.Ok;
    }

    public Godot.Collections.Dictionary LoadFromJson(int slot)
    {
        var path = $"{SaveDir}save_{slot:D2}.json";

        if (!FileAccess.FileExists(path)) return new();

        using var file = FileAccess.Open(path, FileAccess.ModeFlags.Read);
        if (file == null) return new();

        var jsonString = file.GetAsText();
        var parsed = Json.ParseString(jsonString);

        if (parsed.VariantType != Variant.Type.Dictionary)
        {
            GD.PushError("JSON parse error in save file");
            return new();
        }

        return parsed.As<Godot.Collections.Dictionary>();
    }

    public Godot.Collections.Dictionary CollectGameState()
    {
        var player = GetTree().GetFirstNodeInGroup("player") as Player;

        return new Godot.Collections.Dictionary
        {
            { "version", 1 },
            { "timestamp", (long)Time.GetUnixTimeFromSystem() },
            {
                "player", new Godot.Collections.Dictionary
                {
                    { "position_x", player?.GlobalPosition.X ?? 0f },
                    { "position_y", player?.GlobalPosition.Y ?? 0f },
                    { "health", player?.Health ?? 100 }
                }
            },
            { "level", GetTree().CurrentScene?.SceneFilePath ?? "" }
        };
    }
}
```

## Pattern 3: Node-Based Serialization

Save/load individual nodes using groups:

```csharp
// ISaveable.cs — interface for saveable nodes
public interface ISaveable
{
    string SaveId { get; }
    Godot.Collections.Dictionary GetSaveData();
    void LoadSaveData(Godot.Collections.Dictionary data);
}
```

```csharp
// SaveableChest.cs
public partial class SaveableChest : Node2D, ISaveable
{
    [Export] public string SaveId { get; set; } = "";

    public bool IsOpened { get; private set; }

    public Godot.Collections.Dictionary GetSaveData()
        => new() { { "is_opened", IsOpened } };

    public void LoadSaveData(Godot.Collections.Dictionary data)
    {
        IsOpened = data.TryGetValue("is_opened", out var val) && val.As<bool>();
        if (IsOpened)
            GetNode<AnimatedSprite2D>("AnimatedSprite2D").Play("opened");
    }
}
```

```csharp
// SceneSaveManager.cs
public partial class SceneSaveManager : Node
{
    public Godot.Collections.Dictionary CollectSceneData()
    {
        var data = new Godot.Collections.Dictionary();
        foreach (var node in GetTree().GetNodesInGroup("saveable"))
        {
            if (node is ISaveable saveable && !string.IsNullOrEmpty(saveable.SaveId))
                data[saveable.SaveId] = saveable.GetSaveData();
        }
        return data;
    }

    public void ApplySceneData(Godot.Collections.Dictionary data)
    {
        foreach (var node in GetTree().GetNodesInGroup("saveable"))
        {
            if (node is ISaveable saveable && data.TryGetValue(saveable.SaveId, out var d))
                saveable.LoadSaveData(d.As<Godot.Collections.Dictionary>());
        }
    }
}
```

## Save Data Versioning

Handle save format changes between game versions:

```csharp
public static class SaveMigrator
{
    private const int CurrentVersion = 3;

    public static SaveData Migrate(SaveData data)
    {
        while (data.Version < CurrentVersion)
        {
            data = data.Version switch
            {
                1 => MigrateV1ToV2(data),
                2 => MigrateV2ToV3(data),
                _ => throw new InvalidOperationException($"No migration from v{data.Version}")
            };
        }
        data.Version = CurrentVersion;
        return data;
    }

    private static SaveData MigrateV1ToV2(SaveData data)
    {
        // v1 -> v2: Ensure max health is set
        if (data.PlayerMaxHealth == 0)
            data.PlayerMaxHealth = 100;
        data.Version = 2;
        return data;
    }

    private static SaveData MigrateV2ToV3(SaveData data)
    {
        // v2 -> v3: Rename level paths
        data.CurrentLevel = data.CurrentLevel.Replace("levels/", "worlds/");
        data.Version = 3;
        return data;
    }
}
```

## Autosave System

```csharp
public partial class AutosaveManager : Node
{
    [Signal] public delegate void AutosaveStartedEventHandler();
    [Signal] public delegate void AutosaveCompletedEventHandler();

    [Export] public float AutosaveInterval { get; set; } = 300.0f; // 5 minutes
    [Export] public int AutosaveSlot { get; set; } = 0;

    private float _timer;
    private bool _enabled = true;
    private SaveManager _saveManager;

    public override void _Ready()
    {
        _saveManager = GetNode<SaveManager>("/root/SaveManager");
    }

    public override void _Process(double delta)
    {
        if (!_enabled) return;

        _timer += (float)delta;
        if (_timer >= AutosaveInterval)
        {
            _timer = 0;
            Autosave();
        }
    }

    public void Autosave()
    {
        EmitSignal(SignalName.AutosaveStarted);
        if (IsSafeToSave())
            _saveManager.SaveGame(AutosaveSlot);
        EmitSignal(SignalName.AutosaveCompleted);
    }

    private bool IsSafeToSave() => !GetTree().Paused;

    public void PauseAutosave() { _enabled = false; }
    public void ResumeAutosave() { _enabled = true; _timer = 0; }
}
```

## Save File Security

Basic encryption for save files:

```csharp
private const string SaveKey = "your-game-secret-key"; // Store securely, not in source

public Error SaveEncrypted(int slot, Godot.Collections.Dictionary data)
{
    var json = Json.Stringify(data);
    using var file = FileAccess.OpenEncryptedWithPass(
        GetSavePath(slot), FileAccess.ModeFlags.Write, SaveKey);

    if (file == null) return FileAccess.GetOpenError();
    file.StoreString(json);
    return Error.Ok;
}

public Godot.Collections.Dictionary LoadEncrypted(int slot)
{
    using var file = FileAccess.OpenEncryptedWithPass(
        GetSavePath(slot), FileAccess.ModeFlags.Read, SaveKey);

    if (file == null) return new();

    var jsonString = file.GetAsText();
    var parsed = Json.ParseString(jsonString);
    return parsed.As<Godot.Collections.Dictionary>();
}
```

## Best Practices

1. **Use Resources for structured data** — Type safety and editor support
2. **Version your saves** — Always include version number for migration
3. **Validate on load** — Check for corrupt or missing data
4. **Separate settings from progress** — Different update frequencies
5. **Use `user://` for saves** — Platform-independent save location
6. **Test save/load early** — Add system before too much game logic exists
7. **Handle missing fields gracefully** — Use defaults with null-coalescing
8. **Autosave at safe points** — Not during combat or cutscenes

## Common Gotchas

- **Resource paths change**: Store relative paths, not absolute
- **Scene structure changes**: Use IDs, not node paths
- **Circular Resource refs**: `Resource` cannot have circular references
- **Godot.Collections.Array vs List**: Use `Godot.Collections.Array` for exported data
- **Struct serialization**: `Vector2`, `Color` etc. require custom serialization in JSON
- **Cloud saves**: Account for sync conflicts with timestamps
