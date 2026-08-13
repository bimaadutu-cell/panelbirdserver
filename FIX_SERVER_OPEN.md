# BirdServer V1 — server-open fix

## Root cause
The server detail API reconciled an offline server by updating PostgreSQL `pid` to
SQL `NULL`. In the affected hosted database setup, that NULL bind value was omitted
from the parameter list, producing a query with four placeholders but only three
parameters.

## Fix
Stopped servers now persist `pid = 0`. BirdServer already treats PID 0 as not alive,
so this preserves the runtime behavior while avoiding the broken bind parameter.

The same change is applied to the stop/kill/reconciliation paths.

## Deployment
No database migration is required. Replace the project with this fixed archive,
install dependencies, build, and restart the Railway service.
