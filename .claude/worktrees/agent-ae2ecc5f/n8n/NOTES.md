# n8n Flow Notes

## Email Report - Monday-Only Conditional (2026-02-26)

### Change
Removed the standalone "Email Report Trigger" (Schedule Trigger) node and replaced it with an IF conditional node ("Is Monday?") branching off the existing daily Schedule Trigger.

### Why
The email report should only send on Mondays. Rather than maintaining a separate schedule trigger, the daily Schedule Trigger now powers all branches, and a day-of-week check gates the email report path.

### Flow Structure
```
Schedule Trigger (daily)
  ├── Set Scope to Month to Date       → ... (Clockify sync)
  ├── Set Scope to Month to Date (clickup) → ... (Clickup sync)
  ├── Code in JavaScript                → ... (additional processing)
  └── Is Monday? (IF node)
        ├─ True  → Compute Current Month → Fetch Report → Build CSV → Code in JavaScript5 → HTTP Request2 (Microsoft Graph email)
        └─ False → (stops, no email sent)
```

### IF Node Configuration
- **Condition**: `{{ $json['Day of week'] }}` is equal to `Monday` (string comparison)
- **True Branch**: continues to email report chain
- **False Branch**: disconnected (flow stops)
