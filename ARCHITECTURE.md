# Canary CT Monitor - Architecture

## Overview
Canary uses a clean, secure architecture with server-side rendering, form-based mutations, and live data polling via JavaScript.

## Architecture Principles

### 1. Server-Side Rendering (SSR)
- All pages are rendered server-side using Go templates
- Templates located in `web/templates/`
- Base template (`base.html`) provides consistent header/footer/navbar
- Pages: dashboard, login, rules (list, create, edit)

### 2. Forms for Write Operations
- All CREATE, UPDATE, DELETE operations use HTML forms
- Forms include CSRF tokens for security
- Form submissions redirect with success/error messages
- CSRF protection on all state-changing endpoints

### 3. JavaScript for Live Data
- JavaScript ONLY polls read-only API endpoints
- No authentication logic in JavaScript
- No CSRF tokens needed in JavaScript
- Updates every 5 seconds: metrics, matches, performance stats

### 4. Authentication & Authorization
- All write operations require authentication
- Public dashboard mode: viewing allowed, editing requires auth
- Session-based authentication with secure cookies
- User creation via CLI script only (not API)

### 5. API Endpoints
- Clean `/api/*` namespace for programmatic access
- Read-only, no CSRF required
- Backward compatible paths maintained

## Route Structure

### Public Routes (No Auth)
```
GET  /login                - Login page (template)
POST /auth/login           - Login form submission
POST /hook                 - Certspotter webhook (public)
GET  /health               - Health check
```

### Protected HTML Pages (Auth Required)
```
GET  /                     - Dashboard (template with live JS polling)
GET  /rules                - Rules list (template)
GET  /rules/new            - Create rule form (template)
GET  /rules/edit/{name}    - Edit rule form (template)
POST /auth/logout          - Logout (no CSRF needed)
```

### API Endpoints (Read-Only, viewMW)
```
GET  /api/metrics                  - System metrics
GET  /api/metrics/performance      - Performance metrics
GET  /api/matches/recent           - Recent matches
GET  /api/rules                    - Rules list (JSON)
```

### Form Endpoints (Write Operations, Auth + CSRF)
```
POST   /matches/clear              - Clear matches cache
POST   /rules/create               - Create new rule
POST   /rules/update/{name}        - Update existing rule
DELETE /rules/delete/{name}        - Delete rule
PUT    /rules/toggle/{name}        - Toggle rule enabled/disabled
POST   /rules/reload               - Reload rules from YAML
```

### Static Assets (No Auth)
```
GET  /js/*                         - JavaScript files
GET  /theme.css                    - Theme CSS
GET  /canary.jpg                   - Logo
```

## Security

### CSRF Protection
- **Required**: All form submissions (POST/PUT/DELETE/PATCH)
- **Not Required**: 
  - Read-only API endpoints (GET)
  - Public endpoints (/hook, /health)
  - Logout (simple action, no side effects)

### Authentication
- Session-based with secure HTTP-only cookies
- 30-day session expiration
- Middleware: `AuthMiddleware` (require auth) or `ReadOnlyMiddleware` (public view)
- CSRF middleware separate from auth

### User Management
- Users created via CLI script: `scripts/create_user.sh`
- No user creation API endpoint exposed
- Password hashing with bcrypt

## File Structure

```
web/
├── templates/              # Go templates (SSR)
│   ├── base.html          # Base template with header/footer
│   ├── dashboard.html     # Dashboard page
│   ├── login.html         # Login page
│   ├── rules.html         # Rules list
│   └── rule_form.html     # Rule create/edit form
├── js/
│   └── dashboard.js       # Live data polling only (287 lines)
├── theme.css              # Bootstrap + custom theme
├── canary.jpg             # Logo
└── docs.html              # API documentation

internal/handlers/
├── handlers.go            # Core API handlers
├── auth_handlers.go       # Login/logout handlers
└── template_handlers.go   # SSR template handlers

cmd/canary/
└── main.go               # Routes and server setup
```

## Data Flow

### Page Load (Dashboard)
1. User requests `/`
2. Server renders `dashboard.html` template with initial data
3. Browser loads HTML with metrics cards, table structure
4. JavaScript starts polling `/api/*` endpoints every 5 seconds
5. JavaScript updates DOM with live data

### Form Submission (Create Rule)
1. User fills form at `/rules/new`
2. Form includes CSRF token from template
3. POST to `/rules/create` with form data + CSRF token
4. Server validates CSRF, authenticates user
5. Server creates rule, redirects to `/rules?message=success`
6. Template renders with success message

### Live Data (Metrics)
1. JavaScript calls `GET /api/metrics` every 5 seconds
2. No auth headers needed (session cookie automatic)
3. Server returns JSON
4. JavaScript updates DOM elements

## Environment Variables

```bash
PORT=8080                      # Server port
DEBUG=true                     # Log webhook payloads
PUBLIC_DASHBOARD=true          # Allow viewing without auth
DOMAIN=example.com             # Enable secure cookies for production
PARTITION_RETENTION_DAYS=30    # Database partition retention
```

## Development vs Production

### Development (Local)
- Insecure cookies (no HTTPS required)
- CORS: `*`
- Domain: empty

### Production (Behind Reverse Proxy)
- Secure cookies (HTTPS enforced)
- CORS: `https://{DOMAIN}`
- Domain: set via `DOMAIN` env var

## Key Design Decisions

1. **No client-side auth logic**: All auth handled server-side
2. **No CSRF in JavaScript**: Forms handle all writes
3. **No user creation API**: Security through obscurity, CLI only
4. **Logout without CSRF**: Simple action, no sensitive side effects
5. **Template-based UI**: Faster initial load, works without JS
6. **Live polling**: Simple, reliable, no WebSockets complexity
7. **Backward compatible**: Old API paths still work

## Testing

Test the following flows:
1. Login with form at `/login`
2. Dashboard live updates (metrics every 5s)
3. Create/edit/delete rules via forms
4. Clear matches button (CSRF form)
5. Logout button (redirects to login)
6. Public dashboard mode (view only)
7. API endpoints with curl (no CSRF needed)

## Migration Notes

### From Old Architecture
- ✅ Removed: `web/js/rules.js` (forms handle rule management)
- ✅ Moved: Static HTML → Templates (`web/templates/`)
- ✅ Simplified: `dashboard.js` (400+ → 287 lines)
- ✅ Removed: CSRF from logout endpoint
- ✅ Removed: `/config` endpoint (no longer needed)
- ✅ Added: Base template for consistency
- ✅ Added: Form-based login/logout

### Breaking Changes
- None! Backward compatible with old API paths
