// stability, many requests

const http = require("http");

function sendRequest(id) {

    return new Promise((resolve, reject) => {

        const data = JSON.stringify({
            id: `drone-${id}`,
            type: "drone"
        });

        const req = http.request({

            hostname: "localhost",
            port: 8080,
            path: "/unit",
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                "Content-Length": data.length
            }

        }, (res) => {

            resolve(res.statusCode);
        });

        req.on("error", reject);

        req.write(data);

        req.end();
    });
}

async function runLoadTest() {

    console.log("\n=================================");
    console.log("LOAD TEST");
    console.log("=================================\n");

    const REQUEST_COUNT = 100;

    const start = Date.now();

    const promises = [];

    for (let i = 0; i < REQUEST_COUNT; i++) {
        promises.push(sendRequest(i));
    }

    const results = await Promise.all(promises);

    const end = Date.now();

    const successCount = results.filter(
        code => code === 201
    ).length;

    console.log("Requests:", REQUEST_COUNT);
    console.log("Successful:", successCount);
    console.log("Time:", (end - start), "ms");

    if (successCount === REQUEST_COUNT) {
        console.log("\nPASS");
    } else {
        console.log("\nFAIL");
    }
}

module.exports = {
    runLoadTest
};