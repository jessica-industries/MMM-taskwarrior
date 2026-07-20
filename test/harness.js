/* Standalone verification harness for node_helper.js.
 *
 * Spins up an isolated Taskwarrior data dir, adds a few sample tasks, then
 * drives node_helper.js exactly as MagicMirror would (a "START" socket
 * notification) and prints the resulting TASKS/TASK_ERROR payload.
 *
 * Requires the `task` CLI (Taskwarrior 3.x) on PATH. Run: node test/harness.js
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

// Stub the MagicMirror-provided `node_helper` module so we can load the helper
// outside of a running mirror. NodeHelper.create() just returns the definition.
const origLoad = Module._load;
Module._load = function (request, ...rest) {
	if (request === "node_helper") {
		return { create: (def) => def };
	}
	return origLoad.call(this, request, ...rest);
};

// --- isolated Taskwarrior instance -----------------------------------------
const taskData = fs.mkdtempSync(path.join(os.tmpdir(), "mmm-tw-data-"));
const taskrc = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mmm-tw-rc-")), "taskrc");
fs.writeFileSync(taskrc, `data.location=${taskData}\n`);

const env = { ...process.env, TASKDATA: taskData, TASKRC: taskrc };
const add = (...args) =>
	execFileSync("task", ["rc.confirmation=off", "add", ...args], { env });

add("Buy milk", "project:Home", "due:today", "+errand");
add("File taxes", "project:Finance", "due:tomorrow", "priority:H");
add("Overdue report", "project:Work", "due:yesterday");
add("Read spec", "project:Work");

// --- drive the helper -------------------------------------------------------
const helper = require("../node_helper.js");
helper.name = "MMM-taskwarrior";
helper.sendSocketNotification = (notification, payload) => {
	console.log(`\n<< ${notification} >>`);
	if (notification === "TASKS") {
		console.log(`received ${payload.tasks.length} tasks`);
		for (const t of payload.tasks) {
			console.log(
				` - [${t.project || "-"}] ${t.description}` +
					(t.due ? ` (due ${t.due})` : "") +
					(t.urgency != null ? ` urgency=${t.urgency}` : "")
			);
		}
	} else {
		console.log(payload.error);
	}
	helper.clearInstance("test_instance");
	Module._load = origLoad;
	process.exit(notification === "TASKS" ? 0 : 1);
};

helper.start();
helper.socketNotificationReceived("START", {
	identifier: "test_instance",
	config: {
		filter: "status:pending",
		autoSync: false, // no server in this harness
		taskCommand: "task",
		taskrc,
		taskData,
		updateInterval: 10,
		commandTimeout: 15000
	}
});
