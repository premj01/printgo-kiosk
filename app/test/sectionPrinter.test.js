const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { createSectionPrinter } = require("../src/main/sectionPrinter");

for (const modes of [["bw", "color"], ["bw"], ["color"]]) {
    test("submits and tracks " + modes.join(" then "), async t => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "printgo-sections-"));
        t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
        const uploads = path.join(dir, "uploads");
        fs.mkdirSync(uploads);
        for (const name of ["merged.pdf", "other.pdf"]) fs.writeFileSync(path.join(uploads, name), "test");
        const calls = [];
        const finished = Promise.withResolvers();
        const release = Promise.withResolvers();
        const submitted = Promise.withResolvers();
        const sections = modes.map((mode, i) => ({
            mode, printer: mode + "-queue", pageRanges: i === 0 ? "1-3" : "4-5",
            colorMode: mode === "bw" ? "monochrome" : "color",
        }));
        const data = { sessionId: "session", batchId: randomUUID(), fileName: "merged.pdf", sections };
        const kiosk = createSectionPrinter({
            uploads, send() {}, onFinished: finished.resolve,
            async printFile(name, options) {
                assert.equal(name, "merged.pdf");
                assert.equal(options.copies, 1);
                calls.push([options.printer, options.pageRanges, options.colorMode]);
                return { success: true, jobId: options.mode + "-1" };
            },
            async outcome(id) {
                submitted.resolve();
                await release.promise;
                return id.startsWith("bw") ? "completed" : "failed";
            },
        });
        kiosk.receive(data);
        kiosk.receive(data);
        await submitted.promise;
        assert.deepEqual(calls, sections.map(s => [s.printer, s.pageRanges, s.colorMode]));
        assert.ok(fs.existsSync(path.join(uploads, "merged.pdf")));
        release.resolve();
        const job = await finished.promise;
        assert.deepEqual(job.results.map(r => r.status), modes.map(m => m === "bw" ? "completed" : "failed"));
        assert.ok(!fs.existsSync(path.join(uploads, "merged.pdf")));
        assert.ok(fs.existsSync(path.join(uploads, "other.pdf")));
        let replay;
        const restarted = createSectionPrinter({ uploads, printFile: assert.fail, send: (_, value) => { replay = value; } });
        restarted.resume();
        assert.equal(replay.revision, job.revision);
        restarted.acknowledge(replay);
        assert.deepEqual(fs.readdirSync(path.join(dir, "print-receipts")), []);
    });
}
