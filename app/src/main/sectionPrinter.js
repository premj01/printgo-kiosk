const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execute = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readOutcome(jobId) {
    const number = /-(\d+)$/.exec(jobId)?.[1];
    if (!number) return "unknown";
    const uri = "ipp://localhost/jobs/" + number;
    const { stdout } = await execute("ipptool", ["-tv", "-T", "8", uri, path.join(__dirname, "job-state.test")]);
    const state = /job-state \(enum\) = ([\w-]+)/.exec(stdout)?.[1];
    if (["aborted", "canceled", "7", "8"].includes(state)) return "failed";
    if (["completed", "9"].includes(state)) {
        return stdout.includes("job-completed-with-errors") ? "failed" : "completed";
    }
    return ["pending", "pending-held", "processing", "processing-stopped", "3", "4", "5", "6"].includes(state) ? "queued" : "unknown";
}

function createSectionPrinter({ uploads, printFile, send, outcome = readOutcome, onFinished = () => {} }) {
    const directory = path.join(path.dirname(uploads), "print-receipts");
    const running = new Map();
    const receipts = new Map();
    const file = id => path.join(directory, id + ".json");
    function save(job) {
        job.revision++;
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(file(job.batchId) + ".tmp", JSON.stringify(job));
        fs.renameSync(file(job.batchId) + ".tmp", file(job.batchId));
        publish(job);
    }
    function publish({ batchId, sessionId, revision, results, finished }) {
        send("print-section-update", { batchId, sessionId, revision, results, finished });
    }
    async function run(job) {
        // Submit both commands before waiting for either queue to finish.
        for (const [i, part] of job.sections.entries()) {
            const result = job.results[i];
            if (result.status !== "waiting") continue;
            if (part.cancelled) {
                result.status = "failed";
                result.error = "Cancelled before submission";
                save(job);
                continue;
            }
            result.status = "unknown"; // Crash during lp must never re-submit a possibly accepted job.
            save(job);
            const submitted = await printFile(job.fileName, {
                ...job.options, ...part, copies: 1, trackCompletion: true,
            });
            result.jobId = submitted.jobId;
            result.status = submitted.success ? (submitted.jobId ? "queued" : "unknown") : "failed";
            result.error = submitted.error;
            save(job);
            if (part.cancelled && result.jobId) await job.cancelInFlight(result.jobId);
        }
        await Promise.all(job.results.map(async result => {
            let failures = 0;
            while (result.status === "queued") {
                try {
                    result.status = await outcome(result.jobId);
                    failures = 0;
                } catch (error) {
                    if (++failures >= 5) {
                        result.status = "unknown";
                        result.error = error.message;
                    }
                }
                if (result.status === "queued") await pause(2000);
                else save(job);
            }
        }));
        if (!job.results.some(part => part.status === "unknown")) {
            fs.rmSync(path.join(uploads, path.basename(job.fileName)), { force: true });
        }
        job.finished = true;
        save(job);
        onFinished(job);
    }
    function start(job) {
        if (running.has(job.batchId)) return;
        running.set(job.batchId, job);
        run(job).catch(error => console.error("Print batch interrupted", error)).finally(() => running.delete(job.batchId));
    }
    return {
        receive(data) {
            if (!/^[\da-f-]{36}$/i.test(data.batchId) || !data.fileName || !data.sections?.length) return;
            if (receipts.has(data.batchId)) return;
            const job = { batchId: data.batchId, sessionId: data.sessionId, fileName: data.fileName,
                options: { orientation: data.orientation, paperSize: data.paperSize, sides: data.sides, fitToPage: data.fitToPage },
                sections: data.sections, revision: 0, results: data.sections.map(({ mode }) => ({ mode, status: "waiting" })) };
            receipts.set(job.batchId, job);
            save(job);
            start(job);
        },
        resume() {
            if (!fs.existsSync(directory)) return;
            for (const name of fs.readdirSync(directory).filter(name => name.endsWith(".json"))) {
                const job = receipts.get(name.slice(0, -5)) || JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
                receipts.set(job.batchId, job);
                if (!job.finished) start(job);
                publish(job);
            }
        },
        retry() {
            for (const job of receipts.values()) publish(job);
        },
        acknowledge({ batchId, revision }) {
            const job = receipts.get(batchId);
            if (job?.finished && revision === job.revision) {
                fs.rmSync(file(batchId), { force: true });
                receipts.delete(batchId);
            }
        },
        async cancel(printer, cancelJob) {
            const cancellations = [];
            for (const job of running.values()) {
                job.cancelInFlight = cancelJob;
                for (const [i, part] of job.sections.entries()) {
                    if (printer && part.printer !== printer) continue;
                    part.cancelled = true;
                    if (job.results[i].status === "queued") cancellations.push(cancelJob(job.results[i].jobId));
                }
            }
            return Promise.all(cancellations);
        },
        active() { return [...running.values()]; },
    };
}
module.exports = { createSectionPrinter, readOutcome };
