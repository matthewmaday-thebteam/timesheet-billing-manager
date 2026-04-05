---
name: devops
description: "Full DevOps pipeline for Vite + TypeScript + React projects. Runs type checking, design system compliance, tests, local preview, and Vercel deployment — in sequence, failing fast on errors. Use this skill whenever the user says /devops, asks to 'run the pipeline', 'check and deploy', 'build and ship', or wants to validate and deploy their frontend project."
disable-model-invocation: true
---

# DevOps Pipeline

Run the full pipeline sequentially. **Stop immediately on any step failure** — do not proceed to later steps.

## Pipeline Steps

### Step 1: TypeScript Check
Run the TypeScript compiler in check-only mode:
```bash
npx tsc --noEmit
```
If there are errors, report them clearly and stop. Do not continue.

### Step 2: Design System Compliance
Spawn a subagent to run design system compliance checks:

**Subagent instructions:**
- Task: "Check all components in src/ for design system compliance. Report any violations of design tokens, component reuse rules, and styling conventions."
- The subagent should have read-only access to the codebase.
- Allowed tools: read files, list directories, grep/search.

> Subagent: `design-system-enforcer`

If the subagent reports **critical violations** (e.g., hardcoded colors, unauthorized components, missing design tokens), stop the pipeline. **Warnings** (e.g., minor spacing inconsistencies) should be reported but allow the pipeline to continue.

### Step 3: Run Tests
```bash
npx vitest run
```
If any tests fail, report the failures and stop.

### Step 4: Build
```bash
npx vite build
```
If the build fails, report errors and stop.

### Step 5: Local Preview
```bash
npx vite preview --port 4173 &
PREVIEW_PID=$!
echo "Local preview running at http://localhost:4173 (PID: $PREVIEW_PID)"
```
Confirm the preview server started. Let the user know they can check it before proceeding.

### Step 6: Deploy to Vercel
```bash
npx vercel --prod
```
Report the deployment URL on success.

## Output Format

After each step, report:
- ✅ **Step name** — passed (with brief summary)
- ❌ **Step name** — failed (with error details)

At the end, provide a summary:
```
Pipeline Summary
────────────────
✅ TypeScript    — 0 errors
✅ Design System — compliant
✅ Tests         — 14/14 passed
✅ Build         — 482kb gzipped
✅ Local Preview — http://localhost:4173
✅ Vercel        — https://your-app.vercel.app
```

## Notes
- This pipeline always runs all steps in order, failing fast on errors.
- The local preview server is backgrounded — remember to kill it after deployment or when done.
- For the design system step, update the invocation method to match your project's agent/tooling setup.
