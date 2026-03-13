const { exec, execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const { safeSend } = require("./window");

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

// ─── Default print settings (used when server doesn't provide values) ────────
const DEFAULT_PRINT_OPTIONS = {
    copies: 1,
    printer: null,          // null = system default printer
    orientation: "portrait", // portrait | landscape
    paperSize: "A4",        // A4, Letter, Legal, etc.
    sides: "one-sided",     // one-sided | two-sided-long-edge | two-sided-short-edge
    pageRanges: null,       // e.g. "1-3"  or null for all pages
    fitToPage: true,
    colorMode: "monochrome",     // color | monochrome
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Promisified exec wrapper
 */
function run(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
            if (err) return reject(new Error(stderr || err.message));
            resolve(stdout.trim());
        });
    });
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Detect whether a printer supports color by inspecting CUPS options.
 * Falls back to null when capability cannot be determined.
 */
async function getPrinterColorCapability(printerName) {
    try {
        const raw = await run(`lpoptions -p '${printerName}' -l 2>/dev/null || echo ''`);
        if (!raw) return null;

        const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
        const colorLine = lines.find((line) => /^(ColorModel|ColorMode|PrintoutMode)\//i.test(line));
        if (!colorLine) return null;

        // CUPS marks default value with "*" and may include values like Color/Gray/Monochrome.
        const valuesPart = colorLine.split(":").slice(1).join(":");
        const tokens = valuesPart.split(/\s+/).map((token) => token.replace(/^\*/, "")).filter(Boolean);

        const hasColor = tokens.some((token) => /(color|rgb|cmyk)/i.test(token));
        const hasMono = tokens.some((token) => /(gray|grey|mono|black)/i.test(token));

        if (hasColor) return true;
        if (hasMono && !hasColor) return false;
        return null;
    } catch (_) {
        return null;
    }
}

/**
 * Find the single file sitting in the uploads directory.
 * Returns full path, or null if nothing is there.
 */
function getUploadedFilePath() {
    if (!fs.existsSync(UPLOAD_DIR)) return null;

    const files = fs.readdirSync(UPLOAD_DIR).filter((f) => {
        const full = path.join(UPLOAD_DIR, f);
        return fs.statSync(full).isFile();
    });

    if (files.length === 0) return null;
    return path.join(UPLOAD_DIR, files[0]);
}

/**
 * Delete all files in the uploads directory (cleanup after print / cancel).
 */
function cleanUploads() {
    if (!fs.existsSync(UPLOAD_DIR)) return;
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
        try {
            fs.unlinkSync(path.join(UPLOAD_DIR, f));
        } catch (e) {
            console.error("cleanUploads:", e.message);
        }
    }
}

// ─── Core printer functions ──────────────────────────────────────────────────

/**
 * Print a specific file from the uploads folder.
 *
 * @param {string}  fileName - File name provided by the server to print.
 * @param {Object}  options  - Print settings from the server (all optional).
 * @param {number}  options.copies
 * @param {string}  options.printer       - Destination printer name.
 * @param {string}  options.orientation   - portrait | landscape
 * @param {string}  options.paperSize     - A4, Letter, Legal …
 * @param {string}  options.sides         - one-sided | two-sided-long-edge | two-sided-short-edge
 * @param {string}  options.pageRanges    - e.g. "1-5"
 * @param {boolean} options.fitToPage
 * @param {string}  options.colorMode     - color | monochrome
 *
 * @returns {Promise<{ success: boolean, jobId: string|null, error: string|null }>}
 */
async function printFile(fileName, options = {}) {
    if (!fileName) {
        const msg = "No file name provided by server";
        console.error(msg);
        safeSend("status", { text: msg });
        return { success: false, jobId: null, error: msg };
    }

    // Resolve to uploads directory — only use the basename to prevent path traversal
    const safeName = path.basename(fileName);
    const filePath = path.join(UPLOAD_DIR, safeName);

    if (!fs.existsSync(filePath)) {
        const msg = `File not found: ${safeName}`;
        console.error(msg);
        safeSend("status", { text: msg });
        return { success: false, jobId: null, error: msg };
    }

    // Merge with defaults
    const opts = { ...DEFAULT_PRINT_OPTIONS, ...options };

    // Build the `lp` command
    const args = [];

    // printer destination
    if (opts.printer) {
        args.push("-d", opts.printer);
    }

    // number of copies
    args.push("-n", String(opts.copies));

    // page ranges
    if (opts.pageRanges) {
        args.push("-P", opts.pageRanges);
    }

    // lp options (-o)
    const lpOptions = [];

    // orientation
    if (opts.orientation === "landscape") {
        lpOptions.push("landscape");
    }

    // paper size (media)
    if (opts.paperSize) {
        lpOptions.push(`media=${opts.paperSize}`);
    }

    // duplex / sides
    if (opts.sides && opts.sides !== "one-sided") {
        lpOptions.push(`sides=${opts.sides}`);
    }

    // fit to page
    if (opts.fitToPage) {
        lpOptions.push("fit-to-page");
    }

    // color mode
    if (opts.colorMode === "monochrome") {
        lpOptions.push("ColorModel=Gray");
    }

    for (const o of lpOptions) {
        args.push("-o", o);
    }

    // file to print (must be last)
    args.push("--", filePath);

    const cmd = `lp ${args.map(a => `'${a}'`).join(" ")}`;
    console.log("Print command:", cmd);

    safeSend("status", { text: "Printing Started.." });

    try {
        const stdout = await run(cmd);
        // `lp` outputs something like: "request id is MyPrinter-42 (1 file(s))"
        const match = stdout.match(/request id is (\S+)/);
        const jobId = match ? match[1] : null;

        console.log("Printed successfully!", stdout);
        safeSend("status", { text: "Printed Successfully 🎉" });

        return { success: true, jobId, error: null };
    } catch (err) {
        console.error("Error printing:", err.message);
        safeSend("status", { text: `Printing Failed<br>${err.message}` });
        return { success: false, jobId: null, error: err.message };
    }
}

/**
 * Get printer status via `lpstat`.
 *
 * @returns {Promise<{ status: string, raw: string, error: string|null }>}
 */
async function getPrinterStatus() {
    try {
        // -p shows printer status, -d shows the default printer
        const raw = await run("lpstat -p -d 2>/dev/null || echo 'No printers found'");

        // Determine a simple status label
        let status = "unknown";
        if (raw.includes("is idle")) status = "idle";
        else if (raw.includes("now printing")) status = "printing";
        else if (raw.includes("disabled")) status = "disabled";
        else if (raw.includes("No printers found") || raw.includes("No destinations")) status = "no-printer";

        return { status, raw, error: null };
    } catch (err) {
        console.error("getPrinterStatus error:", err.message);
        return { status: "error", raw: "", error: err.message };
    }
}

/**
 * List all connected / configured printers.
 *
 * @returns {Promise<{ printers: Array<{name,description,default,status}>, error: string|null }>}
 */
async function getPrinterList() {
    try {
        // lpstat -a  → lists accepted printers
        // lpstat -d  → shows default
        const [acceptedRaw, defaultRaw] = await Promise.all([
            run("lpstat -a 2>/dev/null || echo ''"),
            run("lpstat -d 2>/dev/null || echo ''"),
        ]);

        // Parse default printer
        const defaultMatch = defaultRaw.match(/system default destination:\s*(\S+)/);
        const defaultPrinter = defaultMatch ? defaultMatch[1] : null;

        // Parse printer list
        const printers = [];
        for (const line of acceptedRaw.split("\n")) {
            const m = line.match(/^(\S+)\s+accepting/);
            if (m) {
                printers.push({
                    name: m[1],
                    isDefault: m[1] === defaultPrinter,
                    accepting: true,
                });
            }
        }

        // Enrich with status and color capability
        try {
            const statusRaw = await run("lpstat -p 2>/dev/null || echo ''");
            for (const printer of printers) {
                const re = new RegExp(`printer ${escapeRegex(printer.name)}\\s+(.+)`);
                const sm = statusRaw.match(re);
                if (sm) {
                    if (sm[1].includes("idle")) printer.status = "idle";
                    else if (sm[1].includes("printing")) printer.status = "printing";
                    else if (sm[1].includes("disabled")) printer.status = "disabled";
                    else printer.status = "unknown";
                } else {
                    printer.status = "unknown";
                }

                const supportsColor = await getPrinterColorCapability(printer.name);
                printer.supportsColor = supportsColor;
                printer.printMode = supportsColor === true ? "color" : supportsColor === false ? "monochrome" : "unknown";
            }
        } catch (_) { /* ignore enrichment errors */ }

        return { printers, error: null };
    } catch (err) {
        console.error("getPrinterList error:", err.message);
        return { printers: [], error: err.message };
    }
}

/**
 * Cancel a print job (or all jobs for a printer).
 *
 * @param {string|null} jobId    – specific job id like "MyPrinter-42". If null, cancels all.
 * @param {string|null} printer  – printer name (used when cancelling all).
 * @returns {Promise<{ success: boolean, error: string|null }>}
 */
async function cancelPrinting(jobId = null, printer = null) {
    try {
        let cmd;
        if (jobId) {
            cmd = `cancel '${jobId}'`;
        } else if (printer) {
            cmd = `cancel -a '${printer}'`;
        } else {
            // cancel all jobs on default printer
            cmd = "cancel -a";
        }

        await run(cmd);
        console.log("Print job cancelled");
        safeSend("status", { text: "Printing cancelled" });
        return { success: true, error: null };
    } catch (err) {
        console.error("cancelPrinting error:", err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Reset printer options to factory defaults.
 *
 * @param {string|null} printer – printer name. If null, resets the default printer.
 * @returns {Promise<{ success: boolean, error: string|null }>}
 */
async function resetPrinterSettings(printer = null) {
    try {
        const dest = printer || (await getDefaultPrinterName());
        if (!dest) {
            return { success: false, error: "No printer found to reset" };
        }

        // lpoptions -p <printer> -l lists current options
        // lpoptions -p <printer> -o option=default resets them
        // Simplest portable way: remove user overrides
        await run(`lpoptions -p '${dest}' -o media=A4 -o sides=one-sided -o fit-to-page -o ColorModel=RGB`);

        console.log(`Printer settings reset for ${dest}`);
        safeSend("status", { text: `Printer settings reset (${dest})` });
        return { success: true, error: null };
    } catch (err) {
        console.error("resetPrinterSettings error:", err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Get the name of the system default printer.
 */
async function getDefaultPrinterName() {
    try {
        const raw = await run("lpstat -d 2>/dev/null");
        const match = raw.match(/system default destination:\s*(\S+)/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

/**
 * Get a list of active/pending print jobs.
 *
 * @returns {Promise<{ jobs: Array<{id,printer,user,size,date}>, error: string|null }>}
 */
async function getJobQueue() {
    try {
        const raw = await run("lpstat -o 2>/dev/null || echo ''");
        const jobs = [];
        for (const line of raw.split("\n")) {
            // Typical line: "MyPrinter-42  user  1024  Mon 10 Mar 2026 00:05:00"
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 4) {
                jobs.push({
                    id: parts[0],
                    user: parts[1],
                    size: parts[2],
                    date: parts.slice(3).join(" "),
                });
            }
        }
        return { jobs, error: null };
    } catch (err) {
        return { jobs: [], error: err.message };
    }
}

/**
 * Set the system default printer.
 *
 * @param {string} printerName
 * @returns {Promise<{ success: boolean, error: string|null }>}
 */
async function setDefaultPrinter(printerName) {
    try {
        await run(`lpoptions -d '${printerName}'`);
        console.log(`Default printer set to ${printerName}`);
        return { success: true, error: null };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Print a test page to verify the printer is working.
 *
 * @param {string|null} printer – target printer name (null = default).
 * @returns {Promise<{ success: boolean, jobId: string|null, error: string|null }>}
 */
async function testPrint(printer = null) {
    try {
        // CUPS ships a built-in test page at /usr/share/cups/data/testprint
        const testPagePaths = [
            "/usr/share/cups/data/testprint",
            "/usr/share/cups/data/testprint.ps",
            "/usr/share/cups/data/default-testpage.pdf",
        ];

        let testPage = null;
        for (const p of testPagePaths) {
            if (fs.existsSync(p)) {
                testPage = p;
                break;
            }
        }

        // If no CUPS test page found, create a simple text file
        if (!testPage) {
            const tmpPath = path.join(UPLOAD_DIR, "__test_page.txt");
            fs.mkdirSync(UPLOAD_DIR, { recursive: true });
            fs.writeFileSync(tmpPath, [
                "================================",
                "      PRINTGO KIOSK TEST PAGE   ",
                "================================",
                "",
                `Date   : ${new Date().toLocaleString()}`,
                `Host   : ${require("os").hostname()}`,
                "",
                "If you can read this, the",
                "printer is working correctly.",
                "",
                "================================",
            ].join("\n"));
            testPage = tmpPath;
        }

        const printerArg = printer ? `-d '${printer}'` : "";
        const cmd = `lp ${printerArg} -- '${testPage}'`;

        safeSend("status", { text: "Printing test page..." });
        const stdout = await run(cmd);

        const match = stdout.match(/request id is (\S+)/);
        const jobId = match ? match[1] : null;

        console.log("Test page sent:", stdout);
        safeSend("status", { text: "Test page printed 🎉" });
        return { success: true, jobId, error: null };
    } catch (err) {
        console.error("testPrint error:", err.message);
        safeSend("status", { text: `Test print failed<br>${err.message}` });
        return { success: false, jobId: null, error: err.message };
    }
}

/**
 * Get ink / toner levels for printers (if supported by the driver).
 * Uses CUPS marker attributes exposed via `lpstat -l -p`.
 *
 * @param {string|null} printer – specific printer or null for all.
 * @returns {Promise<{ levels: Array<{printer,marker,type,level,color}>, error: string|null }>}
 */
async function getInkLevels(printer = null) {
    try {
        // Method 1: Try reading CUPS marker attributes from /etc/cups/printers.conf
        // Method 2: Use lpstat verbose output
        const printerArg = printer ? `-p '${printer}'` : "-p";
        const raw = await run(`lpstat -l ${printerArg} 2>/dev/null || echo ''`);

        const levels = [];

        // Also try reading from CUPS web API (localhost:631) attributes
        // Many drivers expose marker-names, marker-levels via IPP
        try {
            // Get list of printers to check
            const printerNames = [];
            if (printer) {
                printerNames.push(printer);
            } else {
                const listResult = await run("lpstat -a 2>/dev/null || echo ''");
                for (const line of listResult.split("\n")) {
                    const m = line.match(/^(\S+)\s+accepting/);
                    if (m) printerNames.push(m[1]);
                }
            }

            for (const pName of printerNames) {
                // Try reading marker attributes via ipptool or CUPS API
                // The marker info is often in /var/run/cups/ or accessible via lpoptions
                try {
                    const markerOutput = await run(
                        `python3 -c "
import subprocess, re, json
r = subprocess.run(['ipptool', '-tv', 'ipp://localhost/printers/${pName}', '-d', 'uri=ipp://localhost/printers/${pName}', '/dev/stdin'], 
input='{ OPERATION Get-Printer-Attributes\\nGROUP operation-attributes-tag\\nATTR charset attributes-charset utf-8\\nATTR language attributes-natural-language en\\nATTR uri printer-uri ipp://localhost/printers/${pName}\\n}',
capture_output=True, text=True, timeout=5)
out = r.stdout
names = re.findall(r'marker-names.*?=\\s*(.+)', out)
levels = re.findall(r'marker-levels.*?=\\s*(.+)', out)
types = re.findall(r'marker-types.*?=\\s*(.+)', out)
colors = re.findall(r'marker-colors.*?=\\s*(.+)', out)
print(json.dumps({'names':names,'levels':levels,'types':types,'colors':colors}))
" 2>/dev/null`
                    );
                    const parsed = JSON.parse(markerOutput);
                    if (parsed.names.length > 0 && parsed.levels.length > 0) {
                        const names = parsed.names[0].split(",").map(s => s.trim());
                        const lvls = parsed.levels[0].split(",").map(s => parseInt(s.trim(), 10));
                        const types = parsed.types.length > 0
                            ? parsed.types[0].split(",").map(s => s.trim())
                            : names.map(() => "unknown");
                        const colors = parsed.colors.length > 0
                            ? parsed.colors[0].split(",").map(s => s.trim())
                            : names.map(() => "unknown");

                        for (let i = 0; i < names.length; i++) {
                            levels.push({
                                printer: pName,
                                marker: names[i] || "unknown",
                                type: types[i] || "unknown",
                                level: isNaN(lvls[i]) ? -1 : lvls[i],  // -1 = unknown
                                color: colors[i] || "unknown",
                            });
                        }
                    }
                } catch (_) {
                    // ipptool not available or failed — try simpler approach
                    try {
                        const simpleOutput = await run(
                            `cat /var/run/cups/printcap 2>/dev/null || echo ''`
                        );
                        // If we got here without markers, just report unknown
                        if (levels.length === 0) {
                            levels.push({
                                printer: pName,
                                marker: "toner/ink",
                                type: "unknown",
                                level: -1,
                                color: "unknown",
                            });
                        }
                    } catch (__) { /* ignore */ }
                }
            }
        } catch (_) { /* ignore enrichment errors */ }

        return {
            levels,
            supported: levels.some(l => l.level >= 0),
            raw,
            error: null,
        };
    } catch (err) {
        console.error("getInkLevels error:", err.message);
        return { levels: [], supported: false, raw: "", error: err.message };
    }
}

/**
 * Pause (disable) a printer so it queues jobs but does not print.
 *
 * @param {string|null} printer – printer name (null = default).
 * @param {string} reason – human-readable reason for pausing.
 * @returns {Promise<{ success: boolean, error: string|null }>}
 */
async function pausePrinter(printer = null, reason = "Paused by PrintGo Kiosk") {
    try {
        const dest = printer || (await getDefaultPrinterName());
        if (!dest) {
            return { success: false, error: "No printer found to pause" };
        }

        await run(`cupsdisable -r '${reason}' '${dest}'`);
        console.log(`Printer paused: ${dest}`);
        safeSend("status", { text: `Printer paused (${dest})` });
        return { success: true, error: null };
    } catch (err) {
        console.error("pausePrinter error:", err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Resume (enable) a previously paused printer.
 *
 * @param {string|null} printer – printer name (null = default).
 * @returns {Promise<{ success: boolean, error: string|null }>}
 */
async function resumePrinter(printer = null) {
    try {
        const dest = printer || (await getDefaultPrinterName());
        if (!dest) {
            return { success: false, error: "No printer found to resume" };
        }

        await run(`cupsenable '${dest}'`);
        console.log(`Printer resumed: ${dest}`);
        safeSend("status", { text: `Printer resumed (${dest})` });
        return { success: true, error: null };
    } catch (err) {
        console.error("resumePrinter error:", err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Get recent print history from CUPS page_log.
 *
 * @param {number} limit – max number of entries to return.
 * @returns {Promise<{ history: Array<{printer,user,jobId,pages,date}>, error: string|null }>}
 */
async function getPrintHistory(limit = 50) {
    try {
        // CUPS logs jobs in /var/log/cups/page_log (needs read access)
        // Format: printer user jobid date-time total num-sheets job-billing job-hostname ...
        const logPaths = [
            "/var/log/cups/page_log",
            "/var/log/cups/access_log",
        ];

        let logPath = null;
        for (const p of logPaths) {
            try {
                await run(`test -r '${p}'`);
                logPath = p;
                break;
            } catch (_) { /* no access */ }
        }

        if (!logPath) {
            // Fallback: parse lpstat completed jobs
            try {
                const raw = await run(`lpstat -W completed -o 2>/dev/null || echo ''`);
                const history = [];
                for (const line of raw.split("\n")) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 4) {
                        history.push({
                            jobId: parts[0],
                            user: parts[1],
                            size: parts[2],
                            date: parts.slice(3).join(" "),
                        });
                    }
                }
                return { history: history.slice(-limit), error: null };
            } catch (_) {
                return { history: [], error: "No print history available (logs not accessible)" };
            }
        }

        const raw = await run(`tail -n ${limit} '${logPath}'`);
        const history = [];

        for (const line of raw.split("\n")) {
            if (!line.trim()) continue;

            if (logPath.includes("page_log")) {
                // page_log format: printer user jobid datestamp total num-sheets ...
                const parts = line.split(/\s+/);
                if (parts.length >= 5) {
                    history.push({
                        printer: parts[0],
                        user: parts[1],
                        jobId: parts[2],
                        date: parts[3],
                        pages: parts[4],
                    });
                }
            } else {
                // access_log: just return raw lines
                history.push({ raw: line });
            }
        }

        return { history: history.slice(-limit), error: null };
    } catch (err) {
        console.error("getPrintHistory error:", err.message);
        return { history: [], error: err.message };
    }
}

module.exports = {
    printFile,
    getPrinterStatus,
    getPrinterList,
    cancelPrinting,
    resetPrinterSettings,
    cleanUploads,
    getUploadedFilePath,
    getJobQueue,
    setDefaultPrinter,
    getDefaultPrinterName,
    testPrint,
    getInkLevels,
    pausePrinter,
    resumePrinter,
    getPrintHistory,
    DEFAULT_PRINT_OPTIONS,
};
