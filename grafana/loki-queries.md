# Loki / LogQL Reference Queries

Run these in Grafana -> Explore -> Loki datasource.

## Filter by service

```logql
{service="backend"}
{service="celery_worker"}
{service="celery_beat"}
{service="frontend"}
```

## Errors and exceptions

```logql
# Any error string across all services
{service=~".+"} |= "error"

# Python exceptions (traceback)
{service="backend"} |= "Traceback"
{service="celery_worker"} |= "Traceback"

# Structlog level=error (inline JSON parse - slower but accurate)
{service="backend"} | json | level="error"

# Celery task failures
{service="celery_worker"} |= "FAILURE"
{service="celery_worker"} |= "exception"
```

## Receipt extraction

```logql
# All receipt task activity
{service="celery_worker"} |= "receipt"

# Extraction failures
{service="celery_worker"} |= "receipt" |= "error"

# Confidence below threshold (sent to review)
{service="backend"} |= "needs_review"
```

## LLM / AI calls

```logql
# All LLM provider calls
{service="backend"} |= "llm"

# LLM errors or timeouts
{service="backend"} |= "llm" |= "error"
{service="backend"} |= "LLMTimeout"
```

## Auth and security

```logql
# Failed logins / auth errors
{service="backend"} |= "auth" |= "error"

# Rate limit hits
{service="backend"} |= "rate_limit"

# New user signups
{service="backend"} |= "user.created"
```

## Monthly reports

```logql
# All report task activity
{service="celery_worker"} |= "report_task"

# Successful deliveries
{service="celery_worker"} |= "report_task.sent"

# Failures and retries
{service="celery_worker"} |= "report_task.retry"
{service="celery_worker"} |= "report_task.all_retries_exhausted"
```

## Redis / cache

```logql
# Cache misses and hits
{service="backend"} |= "cache.analytics"

# Redis connection issues
{service="backend"} |= "cache.redis"
```

## Demo user

```logql
# Demo reset activity
{service="celery_beat"} |= "demo"
{service="celery_worker"} |= "reset_demo"
```

## Inline JSON parsing

structlog outputs JSON lines. Use `| json` to parse at query time and filter on any field:

```logql
# Filter on any structlog key
{service="backend"} | json | level="warning"
{service="backend"} | json | level="error"

# Extract and display a specific field
{service="backend"} | json | line_format "{{.event}} - {{.error}}"

# Filter on nested event name
{service="celery_worker"} | json | event="report_task.sent"
```

## Volume / rate queries (for dashboard panels)

```logql
# Log line rate per service over time
rate({service="backend"}[5m])

# Error rate
rate({service="backend"} |= "error" [5m])

# Count of receipt task completions in the last hour
count_over_time({service="celery_worker"} |= "extract_receipt" [1h])
```

## Tips

- `|=` is a case-sensitive substring filter (fast, uses index)
- `|~ "pattern"` is a regex filter (slower)
- `!=` excludes lines containing a string
- `| json` parses each line as JSON and promotes keys to labels - use for structured filtering
- `| line_format "{{.field}}"` reshapes the displayed log line
- In Grafana, set the time range in the top-right before running queries
