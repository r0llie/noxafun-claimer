export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/noxa/")) {
      const upstream = new URL(url.pathname.replace("/api/noxa/", "/catalog/rh/"), "https://fun.noxa.eth.link");
      return fetch(upstream, { headers: { accept: "*/*", referer: "https://fun.noxa.eth.link/" } });
    }
    return env.ASSETS.fetch(request);
  }
};