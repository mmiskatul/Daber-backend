# Daber Backend

This backend assumes the frontend already signs users in with Firebase Auth
(Apple, Google, Email). The backend only does two things:

1. Verify the Firebase ID token sent by the frontend.
2. Store or update the user in Firestore.

## Endpoints

- `GET /health`
- `POST /auth/sync-user`
- `GET /me`
- `GET /docs`

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in your Firebase Admin service account values.
3. Install dependencies:

```bash
npm install
```

4. Start the server:

```bash
npm run dev
```

Swagger UI will be available at:

```bash
http://localhost:4000/docs
```

Type-check the backend:

```bash
npm run typecheck
```

Build production JavaScript:

```bash
npm run build
```

## Docker

Build the image:

```bash
docker build -t daber-backend .
```

Run the container with your local `.env`:

```bash
docker run --rm -p 4000:4000 --env-file .env daber-backend
```

## Run Both Services

From the repository root:

```bash
docker compose up --build
```

## Frontend flow

After login succeeds on the frontend:

1. Get the Firebase ID token from the signed-in user.
2. Call `POST /auth/sync-user` with `Authorization: Bearer <idToken>`.
3. Optionally send extra profile fields in the JSON body.

Example request body:

```json
{
  "firstName": "Miskat",
  "lastName": "Ahmed",
  "phone": "+8801XXXXXXXXX"
}
```

Example frontend usage:

```js
const user = auth.currentUser;
const idToken = await user.getIdToken();

await fetch("http://localhost:4000/auth/sync-user", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${idToken}`
  },
  body: JSON.stringify({
    firstName: "Miskat",
    lastName: "Ahmed"
  })
});
```

If you need a freshly minted Firebase ID token:

```js
const freshToken = await auth.currentUser.getIdToken(true);
```

Notes:

- Send the Firebase ID token to the backend, not the Firebase refresh token.
- Firebase client SDK manages refresh tokens internally.
- The backend verifies the ID token on every protected request.

## Firestore collection

Users are stored in:

- `users/{uid}`

Each document contains auth-backed identity fields plus any extra profile fields
you send from the frontend.
