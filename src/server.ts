import { app } from "./routes/api.js";

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => console.log(`Backend running on port ${port}`));
