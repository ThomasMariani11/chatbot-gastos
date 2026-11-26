# SEC-07 Baja de push al cerrar sesión — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cerrar sesión dé de baja las notificaciones de ese dispositivo.

**Architecture:** Dos funciones nuevas en `src/pushNotifications.ts` y una línea en `App.tsx`.

**Tech Stack:** React 19, TypeScript, Vitest/jsdom.

**Spec:** `docs/superpowers/specs/2026-11-25-sec-07-push-al-cerrar-sesion-design.md`

## Global Constraints

- Tope: 3000 ms. `releasePushOnSignOut` nunca lanza. El navegador se desuscribe aunque falle el RPC. Sin migración ni cambios en el bot.

## Review Focus

- Sin conexión (RPC que nunca responde): se desuscribe el navegador y se cierra la sesión al vencer el tope.
- Navegador sin soporte de push o sin service worker: cierra sin errores.
- Sin suscripción: no llama al RPC.

---

### Task 1: Baja al cerrar sesión

**Files:** Modify `src/pushNotifications.ts`, `src/App.tsx` (`handleConfirmSignOut`); Test `tests/push-notifications-ui.test.ts`.

**Interfaces:**
- Produces: `releasePushOnSignOut(env?: PushEnvironment, timeoutMs?: number): Promise<void>`; `signOutDevice(signOut: () => PromiseLike<unknown>, env?: PushEnvironment, timeoutMs?: number): Promise<void>`.

- [ ] **Step 1: Tests** (entorno simulado `environment()` del archivo):
  - con suscripción: llama `delete_push_subscription` con el endpoint y `unsubscribe`.
  - RPC con error: igual `unsubscribe`, no lanza.
  - RPC que nunca resuelve, con tope 50 ms (timers falsos): resuelve y `unsubscribe` fue llamado.
  - sin suscripción: no llama al RPC; sin `serviceWorker`: resuelve.
  - `signOutDevice`: el orden es baja → `signOut`; si la baja falla, `signOut` igual se llama.
- [ ] **Step 2:** `npx vitest run tests/push-notifications-ui.test.ts` → FAIL.
- [ ] **Step 3: Implementar** (`Promise.allSettled([rpc, unsubscribe])` contra un `setTimeout`) y usar `signOutDevice` en `App.tsx`.
- [ ] **Step 4:** → PASS; `npm test`, `npm run lint`, `npm run build` → OK.
- [ ] **Step 5: Commit** `fix(push): dar de baja las notificaciones al cerrar sesión (SEC-07)`; documentar en `CONTEXTO_PESITO_PARA_CLAUDE.md` y `DEPLOY_Y_ROLLBACK.md`.
