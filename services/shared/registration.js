const http = require("http");

// One request at a time; retry startup/network failures until stopped.
function createRegistration({ host, port, path, getPayload, label }) {
    let request = null;
    let retryTimer = null;
    let stopped = false;

    function start() {
        if (stopped || request || retryTimer) return;
        const body = JSON.stringify(getPayload());
        let finished = false;

        function finish(error) {
            if (finished || stopped) return;
            finished = true;
            request = null;
            if (error) {
                console.error(`${label} registration failed: ${error.message}; retrying in 3s`);
                retryTimer = setTimeout(() => {
                    retryTimer = null;
                    start();
                }, 3000);
            } else {
                console.log(`Registered ${label}`);
            }
        }

        request = http.request({
            hostname: host,
            port,
            path,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body)
            }
        }, response => {
            response.on("error", finish);
            response.on("end", () => finish(
                response.statusCode >= 200 && response.statusCode < 300
                    ? null : new Error(`HTTP ${response.statusCode}`)
            ));
            response.resume();
        });
        const timeout = setTimeout(() => {
            if (!finished) request?.destroy(new Error("Registration timed out after 5s"));
        }, 5000);
        request.on("close", () => clearTimeout(timeout));
        request.on("error", finish);
        request.end(body);
    }

    function stop() {
        stopped = true;
        clearTimeout(retryTimer);
        request?.destroy();
    }

    return { start, stop };
}

module.exports = { createRegistration };
