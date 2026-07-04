export async function GET() {
  return Response.json({ ok: true, service: 'web', ts: new Date().toISOString() });
}
