// this test checks:
// GET /status
// POST /unit
// POST /incident

const http = require("http");

function request(options, body = null) {

    return new Promise((resolve, reject) => {

        const req = http.request(options, (res) => {

            let data = "";

            res.on("data", chunk => {
                data += chunk;
            });

            res.on("end", () => {

                resolve({
                    statusCode: res.statusCode,
                    body: data
                });
            });
        });

        req.on("error", reject);

        if (body) {
            req.write(body);
        }

        req.end();
    });
}

async function runFunctionalTests() {

    console.log("\n=================================");
    console.log("FUNCTIONAL TESTS");
    console.log("=================================\n");

    /*
    =================================
    TEST 1
    =================================
    */

    console.log("TEST 1: GET /status");

    const statusResponse = await request({
        hostname: "localhost",
        port: 8080,
        path: "/status",
        method: "GET"
    });

    if (statusResponse.statusCode === 200) {
        console.log("PASS");
    } else {
        console.log("FAIL");
    }

    /*
    =================================
    TEST 2
    =================================
    */

    console.log("\nTEST 2: POST /unit");

    const unitData = JSON.stringify({
        id: "drone-test",
        type: "drone"
    });

    const unitResponse = await request({
        hostname: "localhost",
        port: 8080,
        path: "/unit",
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": unitData.length
        }
    }, unitData);

    if (unitResponse.statusCode === 201) {
        console.log("PASS");
    } else {
        console.log("FAIL");
    }

    /*
    =================================
    TEST 3
    =================================
    */

    console.log("\nTEST 3: POST /incident");

    const incidentData = JSON.stringify({
        type: "water_level_alert",
        x: 5,
        y: 5
    });

    const incidentResponse = await request({
        hostname: "localhost",
        port: 8080,
        path: "/incident",
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": incidentData.length
        }
    }, incidentData);

    if (incidentResponse.statusCode === 201) {
        console.log("PASS");
    } else {
        console.log("FAIL");
    }

    console.log("\nFunctional tests finished.\n");
}

module.exports = {
    runFunctionalTests
};