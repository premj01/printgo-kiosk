const path = require("path");

const RECONNECT_DELAY = 2000;

const videoURLs = {
    success: "https://cdn.dribbble.com/userupload/26582295/file/original-63bbdcbb56d15515935dc9c5b5b144d7.gif",
    loading_cat: path.join(__dirname, "../assets/cat_wait_speaker.mp4")
};

module.exports = { RECONNECT_DELAY, videoURLs };
