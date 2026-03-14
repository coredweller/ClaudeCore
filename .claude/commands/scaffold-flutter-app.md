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
2. **Configure Claude** — Add all items from `.claude` in this repository to the new repository's `.claude` folder that are related to Flutter or general cross-cutting concerns like `code-standards.md`, `core-behaviors.md`, `verification-and-reporting.md`, and `code-reviewer`. Include the cross-cutting agents like `architect.md`, `security-reviewer.md`, `accessibility-auditor.md`, and `ui-standards-expert.md`. Include the required skills folders as well such as `flutter-mobile` and `riverpod-patterns`.
3. Update `pubspec.yaml` with Riverpod, Freezed, GoRouter, Firebase dependencies
4. Create clean architecture folder structure:
   - `lib/core/` — constants, theme, utils, shared widgets
   - `lib/features/<feature>/data/` — datasources, models, repositories impl
   - `lib/features/<feature>/domain/` — entities, repository contracts, usecases
   - `lib/features/<feature>/presentation/` — providers, screens, widgets
   - `lib/routing/` — GoRouter config
5. Create a sample Freezed model with Firestore factory
6. Create a sample Riverpod provider (annotated)
7. Create a sample screen using `ConsumerWidget` + `AsyncValue.when()`
8. Configure GoRouter with sample routes + auth redirect
9. Set up `main.dart` with `ProviderScope` and Firebase init stub
10. Add a sample widget test
11. Run `dart run build_runner build --delete-conflicting-outputs`
12. Print a summary of created files, next steps, and how to run

Use the flutter-mobile skill for patterns and templates.
