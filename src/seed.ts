import axios from 'axios';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './db/schema.js';
import { eq } from 'drizzle-orm';

// Initialize database connection
const sqlite = new Database('roadtrip.db');
const db = drizzle(sqlite, { schema });

// Add a function to fetch the route data from the OSRM API
const fetchRoute = async (waypoints) => {
  try {
    const response = await axios.get(`https://router.project-osrm.org/route/v1/driving/${waypoints.join(';')}?overview=full&geometries=geojson`);
    return response.data.routes[0].geometry.coordinates;
  } catch (error) {
    console.error('Error fetching route:', error);
    return null;
  }
};

// Add a function to generate routes for current history items and store them in the database
const generateRoutesForHistory = async () => {
  try {
    // Only select routes that don't have path data yet
    const routes = await db.select().from(schema.routes); //.where(eq(schema.routes.path, null));
    for (const route of routes) {
      const stops = JSON.parse(route.data);
      const waypoints = stops.map(stop => `${stop.lng},${stop.lat}`);
      const routeCoordinates = await fetchRoute(waypoints);
      if (routeCoordinates) {
        await db.update(schema.routes)
          .set({ path: JSON.stringify(routeCoordinates.map(coord => [coord[1], coord[0]])) })
          .where(eq(schema.routes.id, route.id));
        console.log(`Generated path for route ${route.id}`);
      }
    }
    console.log('Routes generated and stored in the database');
  } catch (error) {
    console.error('Error generating routes:', error);
  }
};

async function checkAndAddPathColumn() {
  try {
    // Check if the column exists by trying to query it
    await db.run(`SELECT path FROM routes LIMIT 1`);
    console.log('Path column already exists');
  } catch (error) {
    // If the column doesn't exist, add it
    try {
      await db.run(`
        ALTER TABLE routes
        ADD COLUMN path TEXT
      `);
      console.log('Path column added successfully');
    } catch (addError) {
      console.error('Failed to add path column:', addError);
    }
  }
}

async function main() {
  try {
    // First check and add the path column if needed
    // await checkAndAddPathColumn();

    // Then generate routes for routes that don't have path data
    await generateRoutesForHistory();
  } catch (error) {
    console.error('Error in main execution:', error);
  } finally {
    // Close the database connection only after all operations are complete
    sqlite.close();
    console.log('Database connection closed');
  }
}

// Execute the main function
main();
