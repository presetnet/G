export function requestFromEvent(event) {
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
  let body = event.body;
  if (body && /application\/json/i.test(headers["content-type"] || "")) {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  return {
    method: event.httpMethod || "GET",
    headers,
    query: event.queryStringParameters || {},
    body,
  };
}

export function responseCapture() {
  const headers = {};
  let statusCode = 200;
  let body = "";
  const res = {
    setHeader(name, value) { headers[name] = String(value); },
    status(code) { statusCode = code; return res; },
    json(value) {
      if (!Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
        headers["Content-Type"] = "application/json; charset=utf-8";
      }
      body = JSON.stringify(value);
      return res;
    },
    end(value = "") { body = value === undefined ? "" : String(value); return res; },
  };
  return {
    res,
    finish() {
      return { statusCode, headers, body };
    },
  };
}

export async function invoke(handler, event) {
  const response = responseCapture();
  await handler(requestFromEvent(event), response.res);
  return response.finish();
}
