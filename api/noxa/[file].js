const SAFE_FILE = /^(?:wallets-[0-9a-f]|search-index)\.json$/i;

export default async function handler(request, response) {
  const file = String(request.query.file || "");
  if (!SAFE_FILE.test(file)) {
    return response.status(400).json({ error: "Invalid catalog file" });
  }

  try {
    const upstream = await fetch(`https://fun.noxa.eth.link/catalog/rh/${file}`, {
      headers: {
        accept: "application/json",
        referer: "https://fun.noxa.eth.link/"
      }
    });

    if (!upstream.ok) {
      return response.status(upstream.status).json({ error: "Catalog unavailable" });
    }

    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    return response.status(200).send(await upstream.text());
  } catch {
    return response.status(502).json({ error: "Catalog request failed" });
  }
}
