const {
    runFunctionalTests
} = require("./functional.test");

const {
    runLoadTest
} = require("./load.test");

async function main() {

    try {

        await runFunctionalTests();

        await runLoadTest();

        console.log("\n=================================");
        console.log("ALL TESTS FINISHED");
        console.log("=================================\n");

    } catch (err) {

        console.error("\nTEST FAILURE\n");

        console.error(err);
    }
}

main();

// node tests/testRunner.js