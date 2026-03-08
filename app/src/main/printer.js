const { print } = require("pdf-to-printer");
const { safeSend } = require("./window");

function printPDF(filePath) {
    safeSend('status', { text: "Printing Started.." });

    return print(filePath)
        .then(() => {
            console.log("Printed successfully!");
            safeSend('status', { text: "Printed Successfully 🎉" });
        })
        .catch((err) => {
            console.error("Error printing PDF:", err);
            safeSend('status', { text: `Something Wrong Happened<br>${err}` });
            return err;
        });
}

module.exports = { printPDF };
