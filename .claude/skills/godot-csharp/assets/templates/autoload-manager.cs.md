# Autoload Manager Template

Template for global singleton managers in Godot 4.x C#.

## Usage

Register as autoload in Project Settings > Autoload. Keep autoloads thin — services only, not game logic.
Access autoloads via `GetNode<T>("/root/ManagerName")`. Note: `Engine.GetSingleton()` is for built-in engine singletons (e.g. `RenderingServer`) — it does **not** find project autoloads registered in Project Settings.

## Basic Manager Template

```csharp
using Godot;

/// <summary>
/// Global ${description} manager.
/// Access via autoload path: /root/${ManagerName}.
/// </summary>
public partial class ${ManagerName}Manager : Node
{
    // === Signals ===

    [Signal] public delegate void ${EventOccurred}EventHandler(${Type} ${data});


    // === Private Fields ===

    private ${Type} _${internalState};


    // === Lifecycle ===

    public override void _Ready()
    {
        // Initialize manager state
    }


    // === Public API ===

    /// <summary>${Description of this method.}</summary>
    public ${ReturnType} ${PublicMethod}(${Type} ${param})
    {
        // Implementation
        return default;
    }
}
```

## Audio Manager Example

```csharp
using Godot;
// System.Collections.Generic is covered by ImplicitUsings — no explicit using needed.

/// <summary>
/// Global audio playback manager.
/// Handles music and sound effects with volume control.
/// </summary>
public partial class AudioManager : Node
{
    // === Signals ===

    [Signal] public delegate void MusicChangedEventHandler(string trackName);


    // === Constants ===

    private const float MusicFadeDuration = 1.0f;


    // === Exports ===

    [Export] public StringName MusicBus { get; set; } = "Music";
    [Export] public StringName SfxBus { get; set; } = "SFX";


    // === Private Fields ===

    private AudioStreamPlayer _musicPlayer;
    private readonly List<AudioStreamPlayer> _sfxPlayers = new();
    private string _currentMusic = "";


    // === Lifecycle ===

    public override void _Ready()
    {
        SetupMusicPlayer();
        SetupSfxPool();
    }

    private void SetupMusicPlayer()
    {
        _musicPlayer = new AudioStreamPlayer { Bus = MusicBus };
        AddChild(_musicPlayer);
    }

    private void SetupSfxPool()
    {
        for (int i = 0; i < 8; i++)
        {
            var player = new AudioStreamPlayer { Bus = SfxBus };
            AddChild(player);
            _sfxPlayers.Add(player);
        }
    }


    // === Music ===

    public async void PlayMusic(AudioStream stream, bool fadeIn = true)
    {
        try
        {
            if (_musicPlayer.Stream == stream && _musicPlayer.Playing) return;

            _currentMusic = stream.ResourcePath;

            if (fadeIn && _musicPlayer.Playing)
                await FadeOutMusic();

            _musicPlayer.Stream = stream;
            _musicPlayer.Play();

            if (fadeIn)
                await FadeInMusic();

            EmitSignal(SignalName.MusicChanged, _currentMusic);
        }
        catch (System.Exception e)
        {
            GD.PushError($"AudioManager.PlayMusic failed: {e.Message}");
        }
    }

    public async void StopMusic(bool fadeOut = true)
    {
        try
        {
            if (fadeOut)
                await FadeOutMusic();
            _musicPlayer.Stop();
            _currentMusic = "";
        }
        catch (System.Exception e)
        {
            GD.PushError($"AudioManager.StopMusic failed: {e.Message}");
        }
    }

    private async System.Threading.Tasks.Task FadeOutMusic()
    {
        var tween = CreateTween();
        tween.TweenProperty(_musicPlayer, "volume_db", -40.0f, MusicFadeDuration);
        await ToSignal(tween, Tween.SignalName.Finished);
    }

    private async System.Threading.Tasks.Task FadeInMusic()
    {
        _musicPlayer.VolumeDb = -40.0f;
        var tween = CreateTween();
        tween.TweenProperty(_musicPlayer, "volume_db", 0.0f, MusicFadeDuration);
        await ToSignal(tween, Tween.SignalName.Finished);
    }


    // === Sound Effects ===

    public void PlaySfx(AudioStream stream, float volumeDb = 0.0f)
    {
        var player = GetAvailableSfxPlayer();
        if (player == null) return;
        player.Stream = stream;
        player.VolumeDb = volumeDb;
        player.Play();
    }

    private AudioStreamPlayer GetAvailableSfxPlayer()
    {
        foreach (var player in _sfxPlayers)
            if (!player.Playing) return player;
        return _sfxPlayers[0]; // Fallback to first
    }


    // === Volume Control ===

    public void SetMusicVolume(float linear)
    {
        int idx = AudioServer.GetBusIndex(MusicBus);
        AudioServer.SetBusVolumeDb(idx, Mathf.LinearToDb(linear));
    }

    public void SetSfxVolume(float linear)
    {
        int idx = AudioServer.GetBusIndex(SfxBus);
        AudioServer.SetBusVolumeDb(idx, Mathf.LinearToDb(linear));
    }

    public float GetMusicVolume()
        => Mathf.DbToLinear(AudioServer.GetBusVolumeDb(AudioServer.GetBusIndex(MusicBus)));

    public float GetSfxVolume()
        => Mathf.DbToLinear(AudioServer.GetBusVolumeDb(AudioServer.GetBusIndex(SfxBus)));
}
```

## Event Bus Example

```csharp
using Godot;

/// <summary>
/// Global event bus for decoupled communication.
/// Use for game-wide events that multiple systems care about.
/// </summary>
public partial class EventBus : Node
{
    // === Game State Events ===

    [Signal] public delegate void GameStartedEventHandler();
    [Signal] public delegate void GamePausedEventHandler();
    [Signal] public delegate void GameResumedEventHandler();
    [Signal] public delegate void GameOverEventHandler();


    // === Player Events ===

    [Signal] public delegate void PlayerSpawnedEventHandler(Node2D player);
    [Signal] public delegate void PlayerDiedEventHandler();
    [Signal] public delegate void PlayerRespawnedEventHandler();
    [Signal] public delegate void PlayerHealthChangedEventHandler(int current, int maximum);


    // === Level Events ===

    [Signal] public delegate void LevelStartedEventHandler(string levelName);
    [Signal] public delegate void LevelCompletedEventHandler(string levelName);
    [Signal] public delegate void CheckpointReachedEventHandler(string checkpointId);


    // === Combat Events ===

    [Signal] public delegate void DamageDealtEventHandler(Node source, Node target, int amount);
    [Signal] public delegate void EnemyKilledEventHandler(Node enemy, Node killer);


    // === UI Events ===

    [Signal] public delegate void ShowDialogueEventHandler(string dialogueId);
    [Signal] public delegate void HideDialogueEventHandler();
    [Signal] public delegate void ShowNotificationEventHandler(string message);


    // === Economy Events ===

    [Signal] public delegate void CurrencyChangedEventHandler(int amount, int total);
    [Signal] public delegate void ItemPurchasedEventHandler(string itemId);

    // Usage — always fetch the autoload node first; static access does not work in C#:
    // var bus = GetNode<EventBus>("/root/EventBus");
    // bus.EmitSignal(EventBus.SignalName.PlayerDied);
    // bus.PlayerDied += OnPlayerDied;
}
```

## Save Manager Example

```csharp
using Godot;

public partial class SaveManager : Node
{
    [Signal] public delegate void SaveCompletedEventHandler(int slot);
    [Signal] public delegate void LoadCompletedEventHandler(int slot);
    [Signal] public delegate void SaveFailedEventHandler(int slot, string error);

    private const string SaveDir = "user://saves/";
    private const string SaveExt = ".tres";

    public int CurrentSlot { get; private set; } = -1;

    public override void _Ready()
    {
        DirAccess.MakeDirRecursiveAbsolute(SaveDir);
    }

    public Error Save(int slot, SaveData data)
    {
        var path = GetSavePath(slot);
        var error = ResourceSaver.Save(data, path);

        if (error == Error.Ok)
        {
            CurrentSlot = slot;
            EmitSignal(SignalName.SaveCompleted, slot);
        }
        else
        {
            EmitSignal(SignalName.SaveFailed, slot, error.ToString());
        }

        return error;
    }

    public SaveData LoadSave(int slot)
    {
        var path = GetSavePath(slot);

        if (!FileAccess.FileExists(path))
            return null;

        var data = ResourceLoader.Load<SaveData>(path);
        if (data == null) return null;

        CurrentSlot = slot;
        EmitSignal(SignalName.LoadCompleted, slot);
        return data;
    }

    public Error DeleteSave(int slot)
    {
        var path = GetSavePath(slot);
        return FileAccess.FileExists(path) ? DirAccess.RemoveAbsolute(path) : Error.Ok;
    }

    public bool SaveExists(int slot) => FileAccess.FileExists(GetSavePath(slot));

    private string GetSavePath(int slot) => $"{SaveDir}save_{slot:D2}{SaveExt}";
}
```

## Best Practices

1. **Keep autoloads thin** — Logic goes in components, not managers
2. **Use signals for events** — Don't tightly couple systems
3. **Avoid storing game state** — Player health belongs on Player
4. **Initialize in _Ready** — Not in constructors
5. **Document public API** — What methods are for external use
6. **Consider alternatives** — Maybe you don't need an autoload
7. **Access via typed GetNode** — `GetNode<AudioManager>("/root/AudioManager")`
