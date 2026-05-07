function parseRequest(requestText) {

    const [headerPart, bodyPart] = requestText.split("\r\n\r\n");

    const headerLines = headerPart.split("\r\n");

    const [method, path] = headerLines[0].split(" ");

    const headers = {};

    for (let i = 1; i < headerLines.length; i++) {

        const [key, value] = headerLines[i].split(": ");

        headers[key] = value;
    }

    return {
        method,
        path,
        headers,
        body: bodyPart || ""
    };
}

module.exports = {
    parseRequest
};