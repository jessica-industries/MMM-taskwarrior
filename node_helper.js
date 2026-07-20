/* MagicMirror²
 * Module: MMM-taskwarrior
 *
 * Backend helper. Shells out to the Taskwarrior `task` CLI (which talks to a
 * TaskChampion sync server) to sync and export tasks, then pushes the parsed
 * JSON to the frontend. Runs on the mirror host, where `task` (Taskwarrior 3.x)
 * must be installed.
 */
const NodeHelper = require("node_helper");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Overrides applied to every `task` invocation so output is clean and no
// interactive prompt can ever block the child process.
const BASE_ARGS = ["rc.confirmation=off", "rc.verbose=nothing", "rc.color=off"];

module.exports = NodeHelper.create({
	start() {
		// Per module-instance state, keyed by the frontend `identifier` so that
		// multiple instances of the module can coexist.
		this.instances = {};
		console.log(`${this.name} helper started`);
	},

	stop() {
		for (const id of Object.keys(this.instances)) {
			this.clearInstance(id);
		}
	},

	socketNotificationReceived(notification, payload) {
		if (notification === "START") {
			this.startInstance(payload.identifier, payload.config);
		}
	},

	// --- instance lifecycle -------------------------------------------------

	startInstance(identifier, config) {
		this.clearInstance(identifier);

		const instance = { config, timer: null, taskrcPath: null };
		try {
			instance.taskrcPath = this.buildTaskrc(config);
		} catch (err) {
			this.sendError(identifier, `Failed to prepare taskrc: ${err.message}`);
			return;
		}
		this.instances[identifier] = instance;

		// Fetch immediately, then on the configured interval.
		this.fetchTasks(identifier);
		const minutes = Number(config.updateInterval) > 0 ? Number(config.updateInterval) : 10;
		instance.timer = setInterval(() => this.fetchTasks(identifier), minutes * 60 * 1000);
	},

	clearInstance(identifier) {
		const instance = this.instances[identifier];
		if (!instance) return;
		if (instance.timer) clearInterval(instance.timer);
		if (instance.taskrcPath) {
			fs.rm(instance.taskrcPath, { force: true }, () => {});
		}
		delete this.instances[identifier];
	},

	// --- command construction ----------------------------------------------

	/**
	 * When any sync override is supplied, write a private taskrc (mode 0600)
	 * that `include`s the host's existing taskrc and appends the sync.* keys.
	 * This keeps the encryption secret out of the process list (`ps`), unlike
	 * passing it as an `rc.sync.encryption_secret=` argument. Returns the path
	 * to that file, or null when no overrides are set (use the host config).
	 */
	buildTaskrc(config) {
		const settings = this.syncSettings(config);
		if (settings.length === 0) return null;

		const baseRc =
			config.taskrc || process.env.TASKRC || path.join(os.homedir(), ".taskrc");

		const lines = [];
		if (fs.existsSync(baseRc)) {
			lines.push(`include ${baseRc}`);
		}
		lines.push(...settings, "");

		const file = path.join(
			os.tmpdir(),
			`mmm-taskwarrior-${process.pid}-${Date.now()}.taskrc`
		);
		fs.writeFileSync(file, lines.join("\n"), { mode: 0o600 });
		return file;
	},

	// Map the MM² sync options onto Taskwarrior config keys. Empty options are
	// skipped so the host's existing config is used for anything not overridden.
	syncSettings(config) {
		const out = [];
		if (config.serverUrl) {
			let url = config.serverUrl;
			if (config.serverPort) {
				const u = new URL(url);
				u.port = String(config.serverPort);
				url = u.toString();
				// URL.toString() appends a trailing slash; preserve the original.
				if (!config.serverUrl.endsWith("/")) url = url.replace(/\/$/, "");
			}
			out.push(`sync.server.url=${url}`);
		}
		if (config.clientId) out.push(`sync.server.client_id=${config.clientId}`);
		if (config.encryptionSecret)
			out.push(`sync.encryption_secret=${config.encryptionSecret}`);
		return out;
	},

	// Accept a filter as a string ("status:pending project:Home") or an array
	// (["status:pending", "project:Home"]). Arrays avoid whitespace/quoting
	// surprises. Filter args are placed before the `export` command.
	filterArgs(filter) {
		if (Array.isArray(filter)) return filter.map(String).filter((s) => s.length);
		if (typeof filter === "string" && filter.trim().length) {
			return filter.trim().split(/\s+/);
		}
		return [];
	},

	envFor(instance) {
		const env = { ...process.env };
		if (instance.taskrcPath) env.TASKRC = instance.taskrcPath;
		else if (instance.config.taskrc) env.TASKRC = instance.config.taskrc;
		if (instance.config.taskData) env.TASKDATA = instance.config.taskData;
		return env;
	},

	run(instance, args) {
		const cmd = instance.config.taskCommand || "task";
		const timeout = Number(instance.config.commandTimeout) || 15000;
		return new Promise((resolve, reject) => {
			execFile(
				cmd,
				args,
				{ env: this.envFor(instance), timeout, maxBuffer: 10 * 1024 * 1024 },
				(error, stdout, stderr) => {
					if (error) {
						error.stderr = stderr;
						return reject(error);
					}
					resolve(stdout);
				}
			);
		});
	},

	// --- fetch --------------------------------------------------------------

	async fetchTasks(identifier) {
		const instance = this.instances[identifier];
		if (!instance) return;
		const { config } = instance;

		// 1. Sync first (best-effort). A sync failure must not blank the list —
		//    we still export whatever is in the local replica.
		if (config.autoSync) {
			try {
				await this.run(instance, [...BASE_ARGS, "sync"]);
			} catch (err) {
				console.warn(`${this.name}: task sync failed (showing local tasks): ${err.message}`);
			}
		}

		// 2. Export the filtered task list as JSON.
		try {
			const args = [
				...BASE_ARGS,
				"rc.json.array=on",
				...this.filterArgs(config.filter),
				"export"
			];
			const stdout = await this.run(instance, args);
			const tasks = JSON.parse(stdout || "[]");
			this.sendSocketNotification("TASKS", { identifier, tasks });
		} catch (err) {
			this.sendError(identifier, this.describeError(err));
		}
	},

	describeError(err) {
		if (err.code === "ENOENT") {
			return "Taskwarrior (`task`) not found. Install Taskwarrior 3.x on the mirror host or set `taskCommand`.";
		}
		if (err.killed) {
			return "Taskwarrior command timed out.";
		}
		const detail = (err.stderr || err.message || "").toString().trim();
		return detail ? `Taskwarrior error: ${detail}` : "Taskwarrior command failed.";
	},

	sendError(identifier, error) {
		console.error(`${this.name}: ${error}`);
		this.sendSocketNotification("TASK_ERROR", { identifier, error });
	}
});
