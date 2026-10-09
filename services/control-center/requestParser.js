const { requestError } = require("./errors");

const MAX_HEADER_BYTES = 8 * 1024;
const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5000;

// Limited HTTP/1.1: origin-form targets, one request per connection, fixed-length JSON.
function parseRequest(buffer) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
        if (buffer.length >= MAX_HEADER_BYTES) throw requestError(413, "Headers exceed 8 KiB");
        return null;
    }
    if (headerEnd + 4 > MAX_HEADER_BYTES) throw requestError(413, "Headers exceed 8 KiB");
    const lines = buffer.subarray(0, headerEnd).toString("latin1").split("\r\n");
    const requestLine = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+) (\/[^\x00-\x20\x7f-\xff#]*) HTTP\/(\d+\.\d+)$/.exec(lines.shift());
    if (!requestLine) throw requestError(400, "Invalid request line");
    const [, method, target, version] = requestLine;
    if (version !== "1.1") throw requestError(505, "Only HTTP/1.1 is supported");

    const headers = Object.create(null);
    for (const line of lines) {
        const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([^\x00-\x08\x0a-\x1f\x7f]*)$/.exec(line);
        if (!match) throw requestError(400, "Invalid header");
        const name = match[1].toLowerCase();
        if (Object.hasOwn(headers, name)) throw requestError(400, `Duplicate header: ${name}`);
        headers[name] = match[2].trim();
    }
    if (!headers.host || /[\s/\\@?#]/.test(headers.host)) throw requestError(400, "A valid Host header is required");
    try {
        const host = new URL(`http://${headers.host}`);
        if (!host.hostname) throw new Error("Missing hostname");
    } catch {
        throw requestError(400, "Invalid Host header");
    }
    if (Object.hasOwn(headers, "transfer-encoding")) throw requestError(501, "Transfer-Encoding is not supported");
    if (Object.hasOwn(headers, "expect")) throw requestError(417, "Expect is not supported");

    let contentLength = 0;
    if (Object.hasOwn(headers, "content-length")) {
        if (!/^[0-9]+$/.test(headers["content-length"])) throw requestError(400, "Invalid Content-Length");
        contentLength = Number(headers["content-length"]);
        if (!Number.isSafeInteger(contentLength)) throw requestError(400, "Invalid Content-Length");
        if (contentLength > MAX_BODY_BYTES) throw requestError(413, "Body exceeds 64 KiB");
    } else if (method === "POST") {
        throw requestError(411, "Content-Length is required for POST");
    }
    if (!["GET", "POST"].includes(method)) throw requestError(405, "Only GET and POST are supported");
    if (method === "GET" && contentLength !== 0) throw requestError(400, "GET requests must not have a body");
    if (method === "POST") {
        if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(headers["content-type"] || "")) {
            throw requestError(415, "POST requires application/json with UTF-8 encoding");
        }
        if (headers["content-encoding"] && headers["content-encoding"].toLowerCase() !== "identity") {
            throw requestError(415, "Compressed bodies are not supported");
        }
    }
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + contentLength) return null;
    let body;
    try {
        body = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(bodyStart, bodyStart + contentLength));
    } catch {
        throw requestError(400, "Body must contain valid UTF-8");
    }
    return { method, path: target.split("?")[0], headers, body };
}

module.exports = { parseRequest, MAX_HEADER_BYTES, MAX_BODY_BYTES, REQUEST_TIMEOUT_MS };
