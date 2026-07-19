const health = {
  service: "web",
  status: "ok",
} as const;

export function GET(): Response {
  return Response.json(health, {
    headers: {
      "cache-control": "no-store",
    },
    status: 200,
  });
}
