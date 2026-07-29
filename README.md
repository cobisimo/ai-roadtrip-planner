# AI Roadtrip Planner

AI Roadtrip Planner is a web application that helps users plan their road trips using AI-generated routes. The application is built with React, TypeScript, and Mantine UI, and it integrates with a backend API for authentication and route management.

## Features

- User authentication with email/password and Google login
- AI-generated road trip routes based on user prompts
- Interactive map with markers for stops and route visualization
- Route management (view, delete)
- Responsive design for various screen sizes

## Installation

### Prerequisites

- Node.js (v14 or later)
- npm or yarn

### Steps

1. Clone the repository:

```bash
git clone https://github.com/yourusername/ai-roadtrip-planner.git
cd ai-roadtrip-planner/frontend
```

2. Install dependencies:

```bash
npm install
# or
yarn install
```

3. Start the development server:

```bash
npm run dev
# or
yarn dev
```

## Configuration

The application requires a backend API for authentication and route management. Make sure to configure the backend API URL in the following files:

- `src/atoms/auth.ts`
- `src/atoms/routes.ts`

Update the `fetch` URLs to point to your backend API.

### Google authentication

Create a Google OAuth 2.0 Web application in Google Cloud Console and add this authorized redirect URI:

```text
http://localhost:3000/api/auth/google/callback
```

Add these variables to the root `.env` file:

```text
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
FRONTEND_URL=http://localhost:5173
JWT_SECRET=replace-with-a-long-random-secret
```

Google authentication supports both sign-in and sign-up. A Google user is created automatically on the first successful authentication and linked to an existing local account when the email matches.

## Usage

1. Register or log in to the application.
2. Navigate to the map page.
3. Click on the "+" button to create a new route.
4. Enter a prompt describing your desired road trip.
5. View the generated route on the map with markers for stops and route visualization.
6. Manage your routes by viewing or deleting them from the sidebar.

## Project Structure

The project is structured as follows:

- `src/atoms`: Contains Jotai atoms for state management.
- `src/components`: Contains reusable React components.
- `src/pages`: Contains the main pages of the application.
- `src/App.tsx`: The main application component.
- `src/main.tsx`: The entry point of the application.

## Dependencies

The project uses the following main dependencies:

- React
- TypeScript
- Mantine UI
- React Query
- Jotai
- Leaflet
- React Router

## Contributing

Contributions are welcome! Please follow these steps to contribute:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Make your changes and commit them with descriptive commit messages.
4. Push your changes to your fork.
5. Submit a pull request to the main repository.

## License

This project is licensed under the MIT License. See the LICENSE file for details.
