# SmartFix frontend

The role-based React frontend for SmartFix. This scaffold implements SF-33 and is designed to connect to the FastAPI authentication and domain endpoints as they become available.

## Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

The development server runs at `http://127.0.0.1:5173`.

## Available scripts

- `npm run dev` starts Vite.
- `npm run typecheck` checks TypeScript.
- `npm run lint` runs ESLint.
- `npm run format:check` verifies formatting.
- `npm run build` creates the production bundle.

## Authentication boundary

SF-09 is still under development, so the login page currently provides a clearly labelled demo role selector for Sodeeq. The rest of the application consumes a typed `AuthSession`. Replacing the demo sign-in only requires adapting `AuthContext` to call the real login endpoint and store its returned token and user.

## Route structure

- `/resident` - resident workspace
- `/crew` - repair-crew workspace
- `/operator` - city-operator workspace

Each route is protected and redirects authenticated users away from workspaces that do not match their role.
