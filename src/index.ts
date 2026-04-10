import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => {
	return c.json({ message: "Hello from Bonfire!" });
});

export default app;
