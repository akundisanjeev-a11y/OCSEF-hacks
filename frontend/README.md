# GhostFleet frontend

React, TypeScript and Vite. The current screens are Overview, Investigations,
and Check vessel ID. They use GFW historical area queries, vessel identity
records and risk insights. There is no sample-data switch in the main website.

Follow the [root setup instructions](../README.md#run-ghostfleet) to install the
backend requirements, restore the bundled forecast history, and configure the
private backend GFW token before starting FastAPI.

In a second terminal, from the repository root:

```powershell
cd frontend
npm ci
npm run dev
```

Open the URL Vite prints, usually http://localhost:5173. Its /api proxy forwards
requests to FastAPI on port 8000. For another backend address, set BACKEND_URL
in the frontend terminal or ignored frontend/.env.local and restart Vite.
This address is not an API token. Keep GFW credentials on the backend.

Select a rectangle in Overview to load activity and vessel IDs. The top-right
Filters button controls activity type, dates and provider filters. Open
Investigations to screen the selection or Check vessel ID to search an identifier.
Reports and screening use the area response's exact dates. Changing selection
invalidates old requests and screening; opened reports stay in session history
with their own dates. Reloading clears session data.

The left forecast drawer uses saved observations through July 31, 2025 to
estimate August 4-10, 2025 activity. It covers the center model square and nearby
squares, not the entire selected rectangle. Its dates are separate from GFW's
activity dates. Gold arrows compare estimates, not boat travel.

```powershell
npm test
npm run build
```

Legacy case and Detection Lab components remain in source for compatibility;
they are not the current navigation or a prerequisite for GFW queries.
