---
description: Scaffold a new Flutter app with Riverpod, clean architecture, GoRouter, and Firebase setup
argument-hint: "[app name]"
allowed-tools: Bash, Read, Write, Edit
disable-model-invocation: true
---

# Scaffold Flutter App

Create a new Flutter mobile application with the following:

**App name / theme:** $ARGUMENTS (default to "my_app" if not provided. If a theme is given like "fitness tracker" or "weather app", tailor the sample feature accordingly)

## Steps
1. Run `flutter create --org com.company --platforms ios,android <name>`
2. Update `pubspec.yaml` with Riverpod, Freezed, GoRouter, Firebase dependencies
3. Create clean architecture folder structure:
   - `lib/core/` — constants, theme, utils, shared widgets
   - `lib/features/<feature>/data/` — datasources, models, repositories impl
   - `lib/features/<feature>/domain/` — entities, repository contracts, usecases
   - `lib/features/<feature>/presentation/` — providers, screens, widgets
   - `lib/routing/` — GoRouter config
4. Create a sample Freezed model with Firestore factory
5. Create a sample Riverpod provider (annotated)
6. Create a sample screen using `ConsumerWidget` + `AsyncValue.when()`
7. Configure GoRouter with sample routes + auth redirect
8. Set up `main.dart` with `ProviderScope` and Firebase init stub
9. Add a sample widget test
10. Run `dart run build_runner build --delete-conflicting-outputs`
11. Print a summary of created files, next steps, and how to run

Use the flutter-mobile skill for patterns and templates.
